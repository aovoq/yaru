// ワークスペースの git の状態と、issue に関わるコミットを読む
// TS 版の src/repository.ts。 .yaru には書かない (docs/spec/yaru-format.md の「.yaru に書かないもの」)
// https://git-scm.com/docs/git-log#Documentation/git-log.txt---grepltpatterngt
package repository

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/errs"
	"github.com/aovoq/yaru/internal/workspace"
)

const (
	// RecentCommitsLimit は dashboard に出すコミットの件数 (src/repository.ts:22)
	RecentCommitsLimit = 10
	// IssueCommitsLimit は issue に出すコミットの件数 (src/repository.ts:75)
	IssueCommitsLimit = 20
	// fieldSeparator は git log の %s に改行もタブも入り得るので、レコードの区切りに使う (src/repository.ts:24)
	fieldSeparator = "\x1f"
)

// Commit は git の 1 コミット。Pushed が nil のときは upstream が無く、送ったか分からない (src/repository.ts:4-11)
type Commit struct {
	Hash        string
	Subject     string
	Author      string
	CommittedAt string
	Pushed      *bool
}

// State は今のブランチと、まだ送っていないコミット (src/repository.ts:13-20)
type State struct {
	Branch           *string
	Upstream         *string
	Ahead            *int
	Behind           *int
	UncommittedFiles int
	Commits          []Commit
}

var issueIDPattern = regexp.MustCompile(`^[0-9]+$`)

const commitFormat = "%H" + fieldSeparator + "%h" + fieldSeparator + "%s" + fieldSeparator + "%an" + fieldSeparator + "%cI"

// ReadRepositoryState は root が git の作業ツリーでなければ nil を返す (src/repository.ts:26-69)
func ReadRepositoryState(ctx context.Context, root string) (*State, error) {
	inside, err := gitCommand(ctx, root, "rev-parse", "--is-inside-work-tree")
	if err != nil {
		return nil, err
	}
	if !inside.ok || inside.text != "true" {
		return nil, nil
	}
	branchOutput, err := gitCommand(ctx, root, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return nil, err
	}
	upstreamOutput, err := gitCommand(ctx, root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		return nil, err
	}
	upstream := outputString(upstreamOutput)
	var ahead *int
	var behind *int
	unpushed := map[string]struct{}{}
	if truthy(upstream) {
		counts, countErr := gitCommand(ctx, root, "rev-list", "--left-right", "--count", "@{upstream}...HEAD")
		if countErr != nil {
			return nil, countErr
		}
		countText := ""
		if counts.ok {
			countText = counts.text
		}
		behind, ahead = parseAheadBehind(countText)
		listed, listErr := gitCommand(ctx, root, "rev-list", "@{upstream}..HEAD")
		if listErr != nil {
			return nil, listErr
		}
		if listed.ok {
			unpushed = hashSet(listed.text)
		}
	}
	status, err := gitCommand(ctx, root, "status", "--porcelain")
	if err != nil {
		return nil, err
	}
	statusText := ""
	if status.ok {
		statusText = status.text
	}
	logOutput, err := gitCommand(ctx, root, "log", "-"+strconv.Itoa(RecentCommitsLimit), "--format="+commitFormat)
	if err != nil {
		return nil, err
	}
	logText := ""
	if logOutput.ok {
		logText = logOutput.text
	}
	return &State{
		Branch:           outputString(branchOutput),
		Upstream:         upstream,
		Ahead:            ahead,
		Behind:           behind,
		UncommittedFiles: countNonEmptyLines(statusText),
		Commits:          parseLog(logText, truthy(upstream), unpushed),
	}, nil
}

// CommitsForIssue は #<id> に触れたコミットと、issue のブランチにあって HEAD にまだ無いコミットを返す (src/repository.ts:81-133)
// ブランチ名は refs/heads/<name>^{commit} に解決できたときだけ辿る
// https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---verify
func CommitsForIssue(ctx context.Context, root string, id string, branch *string) ([]Commit, error) {
	if !issueIDPattern.MatchString(id) {
		quoted, quoteErr := document.Quote(id)
		if quoteErr != nil {
			return nil, quoteErr
		}
		return nil, errs.Wrap(fmt.Sprintf("invalid issue id: expected digits, actual %s", quoted), errs.ErrInvalidArgument)
	}
	inside, err := gitCommand(ctx, root, "rev-parse", "--is-inside-work-tree")
	if err != nil {
		return nil, err
	}
	if !inside.ok || inside.text != "true" {
		return []Commit{}, nil
	}
	format := "--format=" + commitFormat
	limit := "-" + strconv.Itoa(IssueCommitsLimit)
	mentioned, err := gitCommand(ctx, root, "log", "--all", limit, "--extended-regexp", "--grep=#"+id+"([^0-9]|$)", format)
	if err != nil {
		return nil, err
	}
	onBranch := commandOutput{}
	if branch != nil && *branch != "" {
		verified, verifyErr := gitCommand(ctx, root, "rev-parse", "--verify", "--quiet", "refs/heads/"+*branch+"^{commit}")
		if verifyErr != nil {
			return nil, verifyErr
		}
		if verified.ok && verified.text != "" {
			logged, logErr := gitCommand(ctx, root, "log", limit, format, verified.text, "--not", "HEAD", "--")
			if logErr != nil {
				return nil, logErr
			}
			onBranch = logged
		}
	}
	lines := append(outputLines(onBranch), outputLines(mentioned)...)
	byHash := map[string]orderedCommit{}
	fullHashes := []string{}
	for order, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, fieldSeparator)
		fullHash := fieldAt(parts, 0)
		if _, exists := byHash[fullHash]; exists {
			continue
		}
		byHash[fullHash] = orderedCommit{
			order: order,
			commit: Commit{
				Hash:        fieldAt(parts, 1),
				Subject:     fieldAt(parts, 2),
				Author:      fieldAt(parts, 3),
				CommittedAt: fieldAt(parts, 4),
			},
		}
		fullHashes = append(fullHashes, fullHash)
	}
	sortCommits(fullHashes, byHash)
	if len(fullHashes) > IssueCommitsLimit {
		fullHashes = fullHashes[:IssueCommitsLimit]
	}
	unpushed, known, err := unpushedCommits(ctx, root, fullHashes)
	if err != nil {
		return nil, err
	}
	commits := make([]Commit, 0, len(fullHashes))
	for _, fullHash := range fullHashes {
		commit := byHash[fullHash].commit
		if known {
			_, found := unpushed[fullHash]
			pushed := !found
			commit.Pushed = &pushed
		}
		commits = append(commits, commit)
	}
	return commits, nil
}

// unpushedCommits は HEAD の upstream から辿れないコミット。upstream が無ければ分からない (src/repository.ts:140-148)
// https://git-scm.com/docs/git-rev-list#Documentation/git-rev-list.txt---not
func unpushedCommits(ctx context.Context, root string, fullHashes []string) (map[string]struct{}, bool, error) {
	upstream, err := gitCommand(ctx, root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		return nil, false, err
	}
	if !upstream.ok {
		return nil, false, nil
	}
	if len(fullHashes) == 0 {
		return map[string]struct{}{}, true, nil
	}
	args := append([]string{"rev-list"}, fullHashes...)
	args = append(args, "--not", "@{upstream}", "--")
	listed, err := gitCommand(ctx, root, args...)
	if err != nil {
		return nil, false, err
	}
	if !listed.ok {
		return nil, false, nil
	}
	return hashSet(listed.text), true, nil
}

type commandOutput struct {
	text string
	ok   bool
}

type orderedCommit struct {
	commit Commit
	order  int
}

func sortCommits(fullHashes []string, byHash map[string]orderedCommit) {
	// Date.parse の差が 0 か NaN のときは、拾った順を使う (src/repository.ts:121-124)
	sort.Slice(fullHashes, func(left int, right int) bool {
		return commitBefore(byHash[fullHashes[left]], byHash[fullHashes[right]])
	})
}

func commitBefore(left orderedCommit, right orderedCommit) bool {
	leftTime, leftOK := commitInstant(left.commit.CommittedAt)
	rightTime, rightOK := commitInstant(right.commit.CommittedAt)
	if leftOK && rightOK && !leftTime.Equal(rightTime) {
		return leftTime.After(rightTime)
	}
	return left.order < right.order
}

func commitInstant(value string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func parseLog(text string, upstream bool, unpushed map[string]struct{}) []Commit {
	commits := []Commit{}
	if text == "" {
		return commits
	}
	for _, line := range strings.Split(text, "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, fieldSeparator)
		fullHash := fieldAt(parts, 0)
		commit := Commit{
			Hash:        fieldAt(parts, 1),
			Subject:     fieldAt(parts, 2),
			Author:      fieldAt(parts, 3),
			CommittedAt: fieldAt(parts, 4),
		}
		if upstream {
			_, found := unpushed[fullHash]
			pushed := !found
			commit.Pushed = &pushed
		}
		commits = append(commits, commit)
	}
	return commits
}

func parseAheadBehind(text string) (*int, *int) {
	// (counts ?? "").split(/\s+/) は空文字を [""] にし、Number("") は 0 (src/repository.ts:34-37)
	parts := strings.Fields(text)
	if text == "" {
		parts = []string{""}
	}
	var behind *int
	var ahead *int
	if len(parts) >= 1 {
		if value, ok := javascriptInteger(parts[0]); ok {
			behind = &value
		}
	}
	if len(parts) >= 2 {
		if value, ok := javascriptInteger(parts[1]); ok {
			ahead = &value
		}
	}
	return behind, ahead
}

func javascriptInteger(text string) (int, bool) {
	value, ok := document.ParseNumber(text)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value != math.Trunc(value) {
		return 0, false
	}
	return int(value), true
}

func hashSet(text string) map[string]struct{} {
	set := map[string]struct{}{}
	if text == "" {
		return set
	}
	for _, line := range strings.Split(text, "\n") {
		if line != "" {
			set[line] = struct{}{}
		}
	}
	return set
}

func countNonEmptyLines(text string) int {
	if text == "" {
		return 0
	}
	count := 0
	for _, line := range strings.Split(text, "\n") {
		if line != "" {
			count++
		}
	}
	return count
}

func outputLines(output commandOutput) []string {
	text := ""
	if output.ok {
		text = output.text
	}
	return strings.Split(text, "\n")
}

func outputString(output commandOutput) *string {
	if !output.ok {
		return nil
	}
	text := output.text
	return &text
}

func truthy(value *string) bool {
	return value != nil && *value != ""
}

func fieldAt(parts []string, index int) string {
	if index >= len(parts) {
		return ""
	}
	return parts[index]
}

func gitCommand(ctx context.Context, root string, args ...string) (commandOutput, error) {
	stdout, exitCode, err := workspace.RunGit(ctx, root, args...)
	if err != nil {
		return commandOutput{}, err
	}
	if exitCode != 0 {
		return commandOutput{}, nil
	}
	return commandOutput{text: strings.TrimSpace(stdout), ok: true}, nil
}
