// コメントの読み書き。パスは .yaru/comments/<id>.md
// TS 版の src/store.ts:648-765。仕様は docs/spec/yaru-format.md の「comment」
// 時刻は clock、JSON は document.MarshalJavaScript、作業ディレクトリは workspace.WorkingDirectory を使う
package store

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/workspace"
)

// Comment はメモリ上の 1 件。Parent が nil のときは TS 版の null
// src/store.ts:53-61
type Comment struct {
	ID        string
	Issue     string
	Parent    *string
	Author    string
	CreatedAt string
	UpdatedAt string
	Body      string
}

// SaveCommentInput は作成と更新の入力。nil は省略
// id が空文字のときは作成になる。TS 版は空文字を falsy として扱う (src/store.ts:98-103, src/store.ts:663)
type SaveCommentInput struct {
	ID     *string
	Issue  *string
	Parent *string
	Body   *string
}

// 一覧の順は en-US の localeCompare。測った組は golang.org/x/text の AmericanEnglish と一致した
// src/store.ts:651
var commentCollator = collate.New(language.AmericanEnglish)

var commentNumericFilePattern = regexp.MustCompile(`^(\d+)\.md$`)

var commentCalendarDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var commentStaleAfterPattern = regexp.MustCompile(`^(\d+)([mhd])$`)

var commentStatuses = []string{"backlog", "todo", "in_progress", "done", "canceled"}

var commentPriorities = []string{"urgent", "high", "medium", "low"}

// ListComments は issue のコメントを createdAt、同じなら id の順で返す
// 壊れたファイルは 1 件だけ省く。issue 自体が読めなければ一覧全体が失敗する
// docs/spec/yaru-format.md の「comment」。src/store.ts:648-652, src/store.ts:707-719
func ListComments(directory string, issueID string) ([]Comment, error) {
	if err := commentRequireIssue(directory, issueID); err != nil {
		return nil, err
	}
	comments, err := commentLoad(directory)
	if err != nil {
		return nil, err
	}
	filtered := make([]Comment, 0)
	for _, comment := range comments {
		if comment.Issue == issueID {
			filtered = append(filtered, comment)
		}
	}
	commentSort(filtered)
	return filtered, nil
}

// GetComment は 1 件を読む。ファイルが無ければ comment not found
// 壊れていても省かない。src/store.ts:655-658
func GetComment(directory string, commentID string) (Comment, error) {
	comment, err := commentRead(commentPath(directory, commentID), commentID)
	if errors.Is(err, os.ErrNotExist) {
		return Comment{}, fmt.Errorf("comment not found: %s", commentID)
	}
	return comment, err
}

// SaveComment は作成するか、id があれば本文を更新する
// 時刻は引数では渡さず、常に clock.Now の ISO 文字列。src/store.ts:661-704
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
func SaveComment(directory string, input SaveCommentInput) (Comment, error) {
	timestamp, err := commentTimestamp()
	if err != nil {
		return Comment{}, err
	}
	if input.ID != nil && *input.ID != "" {
		return commentUpdate(directory, *input.ID, input.Body, timestamp)
	}
	return commentCreate(directory, input, timestamp)
}

func commentUpdate(directory string, commentID string, body *string, timestamp string) (Comment, error) {
	current, err := GetComment(directory, commentID)
	if err != nil {
		return Comment{}, err
	}
	if body != nil && commentJavaScriptTrim(*body) == "" {
		return Comment{}, commentInvalidBody(*body)
	}
	if body != nil {
		current.Body = *body
	}
	current.UpdatedAt = timestamp
	if err := commentReplace(commentPath(directory, current.ID), commentFormat(current)); err != nil {
		return Comment{}, err
	}
	return current, nil
}

func commentCreate(directory string, input SaveCommentInput, timestamp string) (Comment, error) {
	var parent *Comment
	if input.Parent != nil && *input.Parent != "" {
		found, err := GetComment(directory, *input.Parent)
		if err != nil {
			return Comment{}, err
		}
		parent = &found
	}
	issueID := ""
	if parent != nil {
		issueID = parent.Issue
	} else if input.Issue != nil {
		issueID = *input.Issue
	}
	if issueID == "" {
		return Comment{}, errors.New("issue is required when creating a comment")
	}
	// getIssue は時刻と staleAfter を先に見て、issue の形が壊れていれば作成しない
	// src/store.ts:236-237, src/store.ts:681
	if err := commentRequireIssue(directory, issueID); err != nil {
		return Comment{}, err
	}
	body := ""
	if input.Body != nil {
		body = *input.Body
	}
	if commentJavaScriptTrim(body) == "" {
		return Comment{}, commentInvalidBody(body)
	}
	if err := commentMkdir(filepath.Join(directory, "comments")); err != nil {
		return Comment{}, err
	}
	var created Comment
	_, err := commentCreateWithRetry(directory, func(commentID string) (string, error) {
		author, nameErr := commentGitName()
		if nameErr != nil {
			return "", nameErr
		}
		created = Comment{
			ID:        commentID,
			Issue:     issueID,
			Author:    author,
			CreatedAt: timestamp,
			UpdatedAt: timestamp,
			Body:      body,
		}
		if parent != nil {
			parentID := parent.ID
			created.Parent = &parentID
		}
		return commentFormat(created), nil
	})
	if err != nil {
		return Comment{}, err
	}
	return created, nil
}

func commentTimestamp() (string, error) {
	moment, err := clock.Now()
	if err != nil {
		return "", err
	}
	return clock.ISOString(moment), nil
}

func commentInvalidBody(value string) error {
	encoded, err := document.MarshalJavaScript(value)
	if err != nil {
		return err
	}
	return fmt.Errorf("invalid body: expected a non-empty string, actual %s", encoded)
}

func commentLoad(directory string) ([]Comment, error) {
	commentsDirectory := filepath.Join(directory, "comments")
	names, err := commentReaddir(commentsDirectory)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Comment{}, nil
		}
		return nil, err
	}
	comments := make([]Comment, 0)
	for _, name := range names {
		if !strings.HasSuffix(name, ".md") {
			continue
		}
		comment, readErr := commentRead(filepath.Join(commentsDirectory, name), strings.TrimSuffix(name, ".md"))
		if readErr != nil {
			continue
		}
		comments = append(comments, comment)
	}
	return comments, nil
}

func commentRead(path string, stem string) (Comment, error) {
	text, err := commentReadFile(path)
	if err != nil {
		return Comment{}, err
	}
	parsed, err := document.Parse(text)
	if err != nil {
		// parseFrontmatter の失敗は、コメントでも invalid issue file。src/store.ts:790-791
		return Comment{}, errors.New("invalid issue file")
	}
	issueID := commentJavaScriptTrim(parsed.Meta["issue"])
	if issueID == "" {
		return Comment{}, errors.New("invalid comment file")
	}
	author := commentJavaScriptTrim(parsed.Meta["author"])
	if author == "" {
		author, err = commentGitName()
		if err != nil {
			return Comment{}, err
		}
	}
	return Comment{
		ID:        stem,
		Issue:     issueID,
		Parent:    commentBlankToNull(parsed.Meta["parent"]),
		Author:    author,
		CreatedAt: commentJavaScriptTrim(parsed.Meta["createdAt"]),
		UpdatedAt: commentJavaScriptTrim(parsed.Meta["updatedAt"]),
		Body:      parsed.Body,
	}, nil
}

func commentFormat(comment Comment) string {
	parent := ""
	if comment.Parent != nil {
		parent = *comment.Parent
	}
	// 空の値は key: で、コロンの後ろに空白を置かない。src/store.ts:754-765, src/store.ts:862-868
	return document.Format([]document.Field{
		{Key: "id", Value: comment.ID},
		{Key: "issue", Value: comment.Issue},
		{Key: "parent", Value: parent},
		{Key: "author", Value: comment.Author},
		{Key: "createdAt", Value: comment.CreatedAt},
		{Key: "updatedAt", Value: comment.UpdatedAt},
	}, comment.Body)
}

func commentPath(directory string, commentID string) string {
	return filepath.Join(directory, "comments", commentID+".md")
}

func commentNextID(directory string) (string, error) {
	names, err := commentReaddir(filepath.Join(directory, "comments"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "1", nil
		}
		return "", err
	}
	maximum := 0.0
	for _, name := range names {
		match := commentNumericFilePattern.FindStringSubmatch(name)
		if match == nil {
			continue
		}
		number, parseErr := strconv.ParseFloat(match[1], 64)
		if parseErr != nil && !errors.Is(parseErr, strconv.ErrRange) {
			continue
		}
		if number > maximum {
			maximum = number
		}
	}
	return commentFormatJavaScriptNumber(maximum + 1), nil
}

func commentCreateWithRetry(directory string, render func(commentID string) (string, error)) (string, error) {
	for {
		commentID, err := commentNextID(directory)
		if err != nil {
			return "", err
		}
		text, err := render(commentID)
		if err != nil {
			return "", err
		}
		err = commentCreateExclusive(commentPath(directory, commentID), text)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		return commentID, nil
	}
}

func commentCreateExclusive(path string, text string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	_, writeErr := file.Write([]byte(text))
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

func commentReplace(path string, text string) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(text), 0o666); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func commentMkdir(path string) error {
	err := os.MkdirAll(path, 0o777)
	if err == nil {
		return nil
	}
	info, statErr := os.Stat(path)
	if statErr == nil && !info.IsDir() {
		return fmt.Errorf("EEXIST: file already exists, mkdir '%s'", path)
	}
	return err
}

func commentReaddir(directory string) ([]string, error) {
	file, err := os.Open(directory)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = file.Close()
	}()
	entries, err := file.Readdir(-1)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names, nil
}

func commentReadFile(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		// Node の readFileSync がディレクトリに返す文言。パスは付けない
		return "", errors.New("EISDIR: illegal operation on a directory, read")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return commentDecodeUTF8(content), nil
}

func commentDecodeUTF8(content []byte) string {
	if utf8.Valid(content) {
		return string(content)
	}
	var builder strings.Builder
	for len(content) > 0 {
		runeValue, size := utf8.DecodeRune(content)
		builder.WriteRune(runeValue)
		content = content[size:]
	}
	return builder.String()
}

// commentRequireIssue は list と作成が getIssue を通るときの失敗だけを再現する
// issue の型は別の担当が持つので、ここではエラーになる読み方だけを見る
// src/store.ts:236-246, src/store.ts:649, src/store.ts:681
func commentRequireIssue(directory string, issueID string) error {
	if _, err := clock.Now(); err != nil {
		return err
	}
	if _, err := commentReadStaleAfter(directory); err != nil {
		return err
	}
	path := filepath.Join(directory, "issues", issueID+".md")
	text, err := commentReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("issue not found: %s", issueID)
		}
		return err
	}
	parsed, err := document.Parse(text)
	if err != nil {
		return errors.New("invalid issue file")
	}
	return commentValidateIssueMeta(parsed.Meta)
}

func commentValidateIssueMeta(meta map[string]string) error {
	status := commentJavaScriptTrim(meta["status"])
	if status == "" {
		status = "todo"
	}
	if err := commentResolveStatus(status); err != nil {
		return err
	}
	if err := commentResolveAssignee(commentJavaScriptTrim(meta["assignee"])); err != nil {
		return err
	}
	if err := commentResolveDueDate(commentJavaScriptTrim(meta["dueDate"])); err != nil {
		return err
	}
	return commentResolvePriority(commentJavaScriptTrim(meta["priority"]))
}

func commentResolveStatus(value string) error {
	trimmed := commentJavaScriptTrim(value)
	for _, status := range commentStatuses {
		if trimmed == status {
			return nil
		}
	}
	return fmt.Errorf("invalid status: expected %s, actual %s", commentJoinOr(commentStatuses), value)
}

func commentResolveAssignee(value string) error {
	resolved := commentBlankToNull(value)
	if resolved != nil && *resolved == "me" {
		_, err := commentGitName()
		return err
	}
	return nil
}

func commentResolveDueDate(value string) error {
	resolved := commentBlankToNull(value)
	if resolved == nil {
		return nil
	}
	if !commentIsCalendarDate(*resolved) {
		return fmt.Errorf("invalid dueDate: expected YYYY-MM-DD, actual %s", value)
	}
	return nil
}

func commentResolvePriority(value string) error {
	resolved := commentBlankToNull(value)
	if resolved == nil {
		return nil
	}
	for _, priority := range commentPriorities {
		if *resolved == priority {
			return nil
		}
	}
	return fmt.Errorf("invalid priority: expected %s, actual %s", commentJoinOr(commentPriorities), value)
}

func commentReadStaleAfter(directory string) (int64, error) {
	value, found, err := commentReadConfigValue(directory, "staleAfter")
	if err != nil {
		return 0, err
	}
	if !found {
		return 24 * 3_600_000, nil
	}
	return commentParseStaleAfter(value)
}

func commentParseStaleAfter(value string) (int64, error) {
	match := commentStaleAfterPattern.FindStringSubmatch(commentJavaScriptTrim(value))
	amount := 0.0
	if match != nil {
		parsed, err := strconv.ParseFloat(match[1], 64)
		if err == nil || errors.Is(err, strconv.ErrRange) {
			amount = parsed
		}
	}
	if match == nil || amount <= 0 {
		encoded, err := document.MarshalJavaScript(value)
		if err != nil {
			return 0, err
		}
		return 0, fmt.Errorf("invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual %s", encoded)
	}
	unit := map[string]float64{"m": 60_000, "h": 3_600_000, "d": 86_400_000}[match[2]]
	return int64(amount * unit), nil
}

func commentReadConfigValue(directory string, key string) (string, bool, error) {
	content, err := os.ReadFile(filepath.Join(directory, "config.yml"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", false, nil
		}
		return "", false, err
	}
	prefix := key + ":"
	for _, line := range strings.Split(string(content), "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		value := commentJavaScriptTrim(line[len(prefix):])
		if value == "" {
			return "", false, nil
		}
		return value, true, nil
	}
	return "", false, nil
}

func commentGitName() (string, error) {
	workingDirectory, err := workspace.WorkingDirectory()
	if err != nil {
		return "", err
	}
	return workspace.GitName(workingDirectory), nil
}

func commentBlankToNull(value string) *string {
	trimmed := commentJavaScriptTrim(value)
	if trimmed == "" || trimmed == "none" {
		return nil
	}
	return &trimmed
}

func commentJoinOr(items []string) string {
	if len(items) <= 2 {
		return strings.Join(items, " or ")
	}
	return strings.Join(items[:len(items)-1], ", ") + ", or " + items[len(items)-1]
}

func commentIsCalendarDate(value string) bool {
	if !commentCalendarDatePattern.MatchString(value) {
		return false
	}
	year, _ := strconv.Atoi(value[0:4])
	month, _ := strconv.Atoi(value[5:7])
	day, _ := strconv.Atoi(value[8:10])
	// JS の Date は 0 から 99 を 1900 年代にするので、読み直すと年が合わない
	// https://tc39.es/ecma262/#sec-date-year-month-date
	if year < 100 {
		return false
	}
	parsed := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.Local)
	return parsed.Year() == year && int(parsed.Month()) == month && parsed.Day() == day
}

func commentJavaScriptTrim(value string) string {
	start := 0
	end := len(value)
	for start < end {
		runeValue, size := utf8.DecodeRuneInString(value[start:])
		if !commentIsJavaScriptWhitespace(runeValue) {
			break
		}
		start += size
	}
	for end > start {
		runeValue, size := utf8.DecodeLastRuneInString(value[:end])
		if !commentIsJavaScriptWhitespace(runeValue) {
			break
		}
		end -= size
	}
	return value[start:end]
}

func commentIsJavaScriptWhitespace(runeValue rune) bool {
	switch runeValue {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\ufeff', '\u2028', '\u2029':
		return true
	default:
		return unicode.Is(unicode.Zs, runeValue)
	}
}

func commentFormatJavaScriptNumber(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	if value == 0 {
		return "0"
	}
	absolute := math.Abs(value)
	// 1e21 以上は JS の Number#toString が指数表記になる。src/store.ts:364 の String(最大 + 1)
	if absolute >= 1e21 {
		return strconv.FormatFloat(value, 'e', -1, 64)
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func commentCompare(left string, right string) int {
	return commentCollator.CompareString(left, right)
}

func commentSort(comments []Comment) {
	sort.SliceStable(comments, func(leftIndex int, rightIndex int) bool {
		return commentLess(comments[leftIndex], comments[rightIndex])
	})
}

func commentLess(left Comment, right Comment) bool {
	created := commentCompare(left.CreatedAt, right.CreatedAt)
	if created != 0 {
		return created < 0
	}
	return commentCompare(left.ID, right.ID) < 0
}
