//declscope:core
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

const (
	// notifyTimeout は知らせコマンドを待つ上限。src/notify.ts:18 。
	notifyTimeout = 10 * time.Second
	// notificationCheckInterval は serve が見回る間隔。src/web.tsx:638-661 。
	notificationCheckInterval = 60 * time.Second
)

// Event は知らせコマンドへ渡す 1 件。本文は環境変数に入れない。
// src/notify.ts:20-23 、docs/spec/security.md の「知らせコマンド」。
type Event struct {
	Name     string
	URL      string
	Question *questions.Question
	Issue    *store.Issue
}

// QuestionURL は dashboard の質問カードへの URL。src/notify.ts:40-42 。
// https://www.rfc-editor.org/rfc/rfc3986#section-3.5
func QuestionURL(baseURL string, slug string, id string) string {
	return strings.TrimRight(baseURL, "/") + "/p/" + encodeURIComponent(slug) + "/dashboard#q-" + encodeURIComponent(id)
}

// IssueURL は板の issue への URL。src/notify.ts:45-47 。
func IssueURL(baseURL string, slug string, id string) string {
	return strings.TrimRight(baseURL, "/") + "/p/" + encodeURIComponent(slug) + "/?id=" + encodeURIComponent(id)
}

// Notify は config.yml の notify を sh -c で呼ぶ。コマンドが無ければ何もしない。
// 失敗は警告の文で返し、保存は戻さない。src/notify.ts:56-68 。
// 子の環境は herdr と同じ許可リストに、知らせの変数だけを足す。
// docs/spec/security.md の「決定」。
func Notify(space workspace.Workspace, event Event) (string, error) {
	command, found := workspace.ReadConfigValue(context.Background(), space, "notify")
	if !found {
		return "", nil
	}
	payload, err := notifyPayload(event)
	if err != nil {
		return "", err
	}
	return runNotify(space.Root, command, event, payload)
}

// CheckNotifications は期限が近い質問と、止まった issue を 1 回見回る。
// 時計は 1 度だけ読む。src/web.tsx:642-652 、src/notify.ts:88-146 。
func CheckNotifications(stateDirectory string, fallbackBaseURL string) ([]string, error) {
	moment, _, err := readNow()
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	expiring, err := notifyExpiring(ctx, stateDirectory, fallbackBaseURL, moment)
	if err != nil {
		return nil, err
	}
	stale, err := notifyStale(ctx, stateDirectory, fallbackBaseURL, moment)
	if err != nil {
		return nil, err
	}
	return append(expiring, stale...), nil
}

// WatchNotifications は起動直後と、その後 1 分ごとに CheckNotifications を呼ぶ。
// 前の見回りが終わっていなければ次を始めない。src/web.tsx:640-661 。
func WatchNotifications(stateDirectory string, fallbackBaseURL string, writeWarning func(string)) func() {
	if writeWarning == nil {
		logger := log.New(os.Stderr, "", 0)
		writeWarning = func(line string) {
			logger.Println(line)
		}
	}
	return watchNotifications(stateDirectory, fallbackBaseURL, writeWarning, notificationCheckInterval)
}

func watchNotifications(stateDirectory string, fallbackBaseURL string, writeWarning func(string), interval time.Duration) func() {
	var running atomic.Bool
	var stopped atomic.Bool
	check := func() {
		if stopped.Load() {
			return
		}
		if !running.CompareAndSwap(false, true) {
			return
		}
		defer running.Store(false)
		warnings, err := CheckNotifications(stateDirectory, fallbackBaseURL)
		if err != nil {
			writeWarning("notification check failed: " + err.Error())
			return
		}
		for _, warning := range warnings {
			writeWarning(warning)
		}
	}
	go check()
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			if stopped.Load() {
				return
			}
			check()
		}
	}()
	return func() {
		stopped.Store(true)
		ticker.Stop()
	}
}

func notifyExpiring(ctx context.Context, stateDirectory string, fallbackBaseURL string, moment time.Time) ([]string, error) {
	questionService := questions.NewService()
	warnings := []string{}
	for _, registered := range workspace.List(ctx, stateDirectory) {
		opened, err := workspace.Open(ctx, registered.Root)
		if err != nil {
			return nil, err
		}
		if _, found := workspace.ReadConfigValue(ctx, opened, "notify"); !found {
			continue
		}
		baseURL := notifyBaseURL(ctx, opened, fallbackBaseURL)
		listed, err := questionService.ListQuestions(ctx, questionDirectory(opened), questions.QuestionFilter{}, moment)
		if err != nil {
			return nil, err
		}
		for _, question := range questions.QuestionsAboutToExpire(listed, moment) {
			marked, markErr := questionService.MarkExpiringNotified(ctx, questionDirectory(opened), question.ID, moment)
			if markErr != nil {
				return nil, markErr
			}
			warning, notifyErr := Notify(opened, Event{
				Name:     "question.expiring",
				URL:      QuestionURL(baseURL, registered.Slug, question.ID),
				Question: &marked,
			})
			if notifyErr != nil {
				return nil, notifyErr
			}
			if warning != "" {
				warnings = append(warnings, fmt.Sprintf("%s question %s: %s", registered.Slug, question.ID, warning))
			}
		}
	}
	return warnings, nil
}

func notifyStale(ctx context.Context, stateDirectory string, fallbackBaseURL string, moment time.Time) ([]string, error) {
	warnings := []string{}
	notified := readNotified(stateDirectory)
	still := []notifyPair{}
	for _, registered := range workspace.List(ctx, stateDirectory) {
		opened, err := workspace.Open(ctx, registered.Root)
		if err != nil {
			return nil, err
		}
		if _, found := workspace.ReadConfigValue(ctx, opened, "notify"); !found {
			continue
		}
		baseURL := notifyBaseURL(ctx, opened, fallbackBaseURL)
		issues, err := store.ListIssues(ctx, opened, store.Filter{Status: store.Present("in_progress")}, moment, workspace.GitName(ctx, opened.Root))
		if err != nil {
			return nil, err
		}
		for _, issue := range issues {
			if !issue.Stale {
				continue
			}
			key := registered.Root + "#" + issue.ID
			still = append(still, notifyPair{key: key, value: issue.UpdatedAt})
			if previous, found := pairValue(notified, key); found && previous == issue.UpdatedAt {
				continue
			}
			if err := writeNotified(stateDirectory, mergePairs(notified, still)); err != nil {
				return nil, err
			}
			current := issue
			warning, notifyErr := Notify(opened, Event{
				Name:  "issue.stale",
				URL:   IssueURL(baseURL, registered.Slug, issue.ID),
				Issue: &current,
			})
			if notifyErr != nil {
				return nil, notifyErr
			}
			if warning != "" {
				warnings = append(warnings, fmt.Sprintf("%s issue %s: %s", registered.Slug, issue.ID, warning))
			}
		}
	}
	originalText, err := compactJSON(notified)
	if err != nil {
		return nil, err
	}
	stillText, err := compactJSON(still)
	if err != nil {
		return nil, err
	}
	if originalText != stillText {
		if err := writeNotified(stateDirectory, still); err != nil {
			return nil, err
		}
	}
	return warnings, nil
}

func notifyBaseURL(ctx context.Context, space workspace.Workspace, fallback string) string {
	value, found := workspace.ReadConfigValue(ctx, space, "publicUrl")
	if !found {
		return fallback
	}
	trimmed := strings.TrimRight(value, "/")
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func runNotify(root string, command string, event Event, payload []byte) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), notifyTimeout)
	defer cancel()
	child := exec.CommandContext(ctx, "sh", "-c", command)
	child.Dir = root
	child.Env = notifyEnvironment(event)
	child.Stdin = bytes.NewReader(payload)
	child.Stdout = io.Discard
	var stderr bytes.Buffer
	child.Stderr = &stderr
	err := child.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Sprintf("notify command failed: expected to finish within %dms, actual timed out", notifyTimeout.Milliseconds()), nil
	}
	if err == nil {
		return "", nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		detail := strings.TrimSpace(stderr.String())
		message := fmt.Sprintf("notify command failed: expected exit code 0, actual %d", exitErr.ExitCode())
		if detail != "" {
			message += ": " + detail
		}
		return message, nil
	}
	return "", err
}

// notifyEnvironment は親の環境を渡さない。許可リストと、知らせの変数だけ。
// docs/spec/security.md の「herdr を起動するとき」と「決定」。src/notify.ts:177-183 。
func notifyEnvironment(event Event) []string {
	names := []string{"HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "SSH_AUTH_SOCK", "LANG", "LC_ALL", "LC_CTYPE"}
	environment := []string{}
	localePresent := false
	for _, name := range names {
		value, found := os.LookupEnv(name)
		if !found {
			continue
		}
		if name == "LANG" || name == "LC_ALL" || name == "LC_CTYPE" {
			localePresent = true
		}
		environment = append(environment, name+"="+value)
	}
	if !localePresent {
		environment = append(environment, "LANG=en_US.UTF-8")
	}
	environment = append(environment, "PATH="+notifyPath())
	environment = append(environment, "YARU_EVENT="+event.Name, "YARU_URL="+event.URL)
	if event.Name == "issue.stale" && event.Issue != nil {
		environment = append(environment, "YARU_ISSUE_ID="+event.Issue.ID, "YARU_ISSUE_TITLE="+event.Issue.Title)
		return environment
	}
	identifier := ""
	title := ""
	if event.Question != nil {
		identifier = event.Question.ID
		title = event.Question.Title
	}
	environment = append(environment, "YARU_QUESTION_ID="+identifier, "YARU_QUESTION_TITLE="+title)
	return environment
}

func notifyPath() string {
	tail := "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	userName := os.Getenv("USER")
	if userName == "" {
		return tail
	}
	return "/etc/profiles/per-user/" + userName + "/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:" + tail
}

type questionEventJSON struct {
	Event    string       `json:"event"`
	URL      string       `json:"url"`
	Question questionJSON `json:"question"`
}

type issueEventJSON struct {
	Event string    `json:"event"`
	URL   string    `json:"url"`
	Issue issueJSON `json:"issue"`
}

// questionJSON のキー順は withStatus が status を末尾に足した順。src/questions.ts:477-479 、src/questions.ts:656-678 。
type questionJSON struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Issue              *string  `json:"issue"`
	Priority           *string  `json:"priority"`
	DefaultAction      *string  `json:"defaultAction"`
	AnswerBy           *string  `json:"answerBy"`
	Options            []string `json:"options"`
	Author             string   `json:"author"`
	Session            *string  `json:"session"`
	Worktree           *string  `json:"worktree"`
	Branch             *string  `json:"branch"`
	Answer             *string  `json:"answer"`
	AnsweredBy         *string  `json:"answeredBy"`
	AnsweredAt         *string  `json:"answeredAt"`
	AcknowledgedAt     *string  `json:"acknowledgedAt"`
	NotifiedExpiringAt *string  `json:"notifiedExpiringAt"`
	CanceledAt         *string  `json:"canceledAt"`
	CreatedAt          string   `json:"createdAt"`
	UpdatedAt          string   `json:"updatedAt"`
	Body               string   `json:"body"`
	Status             string   `json:"status"`
}

// issueJSON のキー順は parseIssue のオブジェクト順。src/store.ts:807-834 。
type issueJSON struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Status      string   `json:"status"`
	Assignee    *string  `json:"assignee"`
	Labels      []string `json:"labels"`
	DueDate     *string  `json:"dueDate"`
	Priority    *string  `json:"priority"`
	Parent      *string  `json:"parent"`
	Blocks      []string `json:"blocks"`
	BlockedBy   []string `json:"blockedBy"`
	Children    []string `json:"children"`
	StartedAt   *string  `json:"startedAt"`
	CompletedAt *string  `json:"completedAt"`
	CanceledAt  *string  `json:"canceledAt"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
	Session     *string  `json:"session"`
	Worktree    *string  `json:"worktree"`
	Branch      *string  `json:"branch"`
	Stale       bool     `json:"stale"`
	Body        string   `json:"body"`
}

func notifyPayload(event Event) ([]byte, error) {
	if event.Name == "issue.stale" {
		if event.Issue == nil {
			return nil, errors.New("invalid notify event: expected an issue, actual none")
		}
		return document.MarshalJavaScript(issueEventJSON{
			Event: event.Name,
			URL:   event.URL,
			Issue: issueToJSON(*event.Issue),
		})
	}
	if event.Question == nil {
		return nil, errors.New("invalid notify event: expected a question, actual none")
	}
	return document.MarshalJavaScript(questionEventJSON{
		Event:    event.Name,
		URL:      event.URL,
		Question: questionToJSON(*event.Question),
	})
}

func questionToJSON(question questions.Question) questionJSON {
	return questionJSON{
		ID:                 question.ID,
		Title:              question.Title,
		Issue:              question.Issue,
		Priority:           question.Priority,
		DefaultAction:      question.DefaultAction,
		AnswerBy:           question.AnswerBy,
		Options:            copyStrings(question.Options),
		Author:             question.Author,
		Session:            question.Session,
		Worktree:           question.Worktree,
		Branch:             question.Branch,
		Answer:             question.Answer,
		AnsweredBy:         question.AnsweredBy,
		AnsweredAt:         question.AnsweredAt,
		AcknowledgedAt:     question.AcknowledgedAt,
		NotifiedExpiringAt: question.NotifiedExpiringAt,
		CanceledAt:         question.CanceledAt,
		CreatedAt:          question.CreatedAt,
		UpdatedAt:          question.UpdatedAt,
		Body:               question.Body,
		Status:             question.Status,
	}
}

func issueToJSON(issue store.Issue) issueJSON {
	return issueJSON{
		ID:          issue.ID,
		Title:       issue.Title,
		Status:      issue.Status,
		Assignee:    issue.Assignee,
		Labels:      copyStrings(issue.Labels),
		DueDate:     issue.DueDate,
		Priority:    issue.Priority,
		Parent:      issue.Parent,
		Blocks:      copyStrings(issue.Blocks),
		BlockedBy:   copyStrings(issue.BlockedBy),
		Children:    copyStrings(issue.Children),
		StartedAt:   issue.StartedAt,
		CompletedAt: issue.CompletedAt,
		CanceledAt:  issue.CanceledAt,
		CreatedAt:   issue.CreatedAt,
		UpdatedAt:   issue.UpdatedAt,
		Session:     issue.Session,
		Worktree:    issue.Worktree,
		Branch:      issue.Branch,
		Stale:       issue.Stale,
		Body:        issue.Body,
	}
}

type notifyPair struct {
	key   string
	value string
}

func readNotified(directory string) []notifyPair {
	data, err := os.ReadFile(filepath.Join(directory, "notified-stale-issues.json"))
	if err != nil {
		return []notifyPair{}
	}
	entries, err := parseNotified(data)
	if err != nil {
		return []notifyPair{}
	}
	return entries
}

// parseNotified はキー順を残して読む。配列は JavaScript と同じく添字をキーにする。
// 値が文字列でないキーは落とす。src/notify.ts:152-166 、docs/spec/yaru-format.md の「notified-stale-issues.json」。
func parseNotified(data []byte) ([]notifyPair, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil, errors.New("not an object")
	}
	switch delimiter {
	case '{':
		return parseNotifiedObject(decoder)
	case '[':
		return parseNotifiedArray(decoder)
	default:
		return nil, errors.New("not an object")
	}
}

func parseNotifiedObject(decoder *json.Decoder) ([]notifyPair, error) {
	entries := []notifyPair{}
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil, errors.New("not an object")
		}
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		if text, isString := value.(string); isString {
			entries = upsertPair(entries, key, text)
		}
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	return entries, nil
}

func parseNotifiedArray(decoder *json.Decoder) ([]notifyPair, error) {
	entries := []notifyPair{}
	index := 0
	for decoder.More() {
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		if text, isString := value.(string); isString {
			entries = upsertPair(entries, strconvItoa(index), text)
		}
		index++
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	return entries, nil
}

func strconvItoa(value int) string {
	return fmt.Sprintf("%d", value)
}

func upsertPair(entries []notifyPair, key string, value string) []notifyPair {
	for index, entry := range entries {
		if entry.key == key {
			entries[index].value = value
			return entries
		}
	}
	return append(entries, notifyPair{key: key, value: value})
}

func pairValue(entries []notifyPair, key string) (string, bool) {
	for _, entry := range entries {
		if entry.key == key {
			return entry.value, true
		}
	}
	return "", false
}

func mergePairs(notified []notifyPair, still []notifyPair) []notifyPair {
	stillValues := map[string]string{}
	for _, entry := range still {
		stillValues[entry.key] = entry.value
	}
	merged := []notifyPair{}
	seen := map[string]bool{}
	for _, entry := range notified {
		value := entry.value
		if updated, found := stillValues[entry.key]; found {
			value = updated
		}
		merged = append(merged, notifyPair{key: entry.key, value: value})
		seen[entry.key] = true
	}
	for _, entry := range still {
		if seen[entry.key] {
			continue
		}
		merged = append(merged, entry)
	}
	return merged
}

func compactJSON(entries []notifyPair) (string, error) {
	if len(entries) == 0 {
		return "{}", nil
	}
	var builder strings.Builder
	builder.WriteByte('{')
	for index, entry := range entries {
		if index > 0 {
			builder.WriteByte(',')
		}
		key, err := document.MarshalJavaScript(entry.key)
		if err != nil {
			return "", err
		}
		value, err := document.MarshalJavaScript(entry.value)
		if err != nil {
			return "", err
		}
		builder.Write(key)
		builder.WriteByte(':')
		builder.Write(value)
	}
	builder.WriteByte('}')
	return builder.String(), nil
}

func prettyJSON(entries []notifyPair) (string, error) {
	if len(entries) == 0 {
		return "{}\n", nil
	}
	var builder strings.Builder
	builder.WriteString("{\n")
	for index, entry := range entries {
		key, err := document.MarshalJavaScript(entry.key)
		if err != nil {
			return "", err
		}
		value, err := document.MarshalJavaScript(entry.value)
		if err != nil {
			return "", err
		}
		builder.WriteString("  ")
		builder.Write(key)
		builder.WriteString(": ")
		builder.Write(value)
		if index+1 != len(entries) {
			builder.WriteByte(',')
		}
		builder.WriteByte('\n')
	}
	builder.WriteString("}\n")
	return builder.String(), nil
}

func writeNotified(directory string, entries []notifyPair) error {
	text, err := prettyJSON(entries)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0o777); err != nil {
		return err
	}
	path := filepath.Join(directory, "notified-stale-issues.json")
	temporary := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(temporary, []byte(text), 0o666); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
