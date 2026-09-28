// 質問を作ったときの知らせ。TS 版の src/notify.ts
// 失敗しても質問は保存済みなので、戻り値の警告文を CLI が標準エラーへ出す (src/notify.ts:54-68)
package notify

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/workspace"
)

const notifyTimeout = 10 * time.Second

// BaseURL は src/notify.ts:50 の notifyBaseUrl。config.yml の publicUrl が無ければ fallback
func BaseURL(ctx context.Context, opened workspace.Workspace, fallback string) (string, error) {
	publicURL, found := workspace.ReadConfigValue(ctx, opened, "publicUrl")
	if !found {
		return fallback, nil
	}
	return strings.TrimRight(publicURL, "/"), nil
}

// QuestionURL は src/notify.ts:40-42。fragment は dashboard の質問カード
// https://www.rfc-editor.org/rfc/rfc3986#section-3.5
func QuestionURL(baseURL string, slug string, questionID string) string {
	return strings.TrimRight(baseURL, "/") + "/p/" + EncodeURIComponent(slug) + "/dashboard#q-" + EncodeURIComponent(questionID)
}

// QuestionCreated は event question.created を config.yml の notify コマンドへ送る
// environment が nil でもプロセスの環境は読まず、空の環境に知らせの変数だけを足す
// 送り先が無い、または終了コード 0 なら警告文は空。失敗なら src/notify.ts:185-192 の文を返す
func QuestionCreated(ctx context.Context, opened workspace.Workspace, url string, question questions.Question, environment []string) (string, error) {
	command, found := workspace.ReadConfigValue(ctx, opened, "notify")
	if !found {
		return "", nil
	}
	payload, err := document.MarshalJavaScript(questionCreatedEvent{
		Event:    "question.created",
		URL:      url,
		Question: wireQuestion(question),
	})
	if err != nil {
		return "", err
	}
	return runNotify(ctx, opened.Root, command, payload, environment, map[string]string{
		"YARU_EVENT":          "question.created",
		"YARU_URL":            url,
		"YARU_QUESTION_ID":    question.ID,
		"YARU_QUESTION_TITLE": question.Title,
	})
}

// questionCreatedEvent の並びは src/index.ts:619-627 のオブジェクト順
type questionCreatedEvent struct {
	Event    string       `json:"event"`
	URL      string       `json:"url"`
	Question questionWire `json:"question"`
}

// questionWire は JSON.stringify の並び。status は最後 (質問の保存結果と同じ)
type questionWire struct {
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

func wireQuestion(question questions.Question) questionWire {
	options := question.Options
	if options == nil {
		options = []string{}
	}
	return questionWire{
		ID: question.ID, Title: question.Title, Issue: question.Issue, Priority: question.Priority,
		DefaultAction: question.DefaultAction, AnswerBy: question.AnswerBy, Options: options,
		Author: question.Author, Session: question.Session, Worktree: question.Worktree, Branch: question.Branch,
		Answer: question.Answer, AnsweredBy: question.AnsweredBy, AnsweredAt: question.AnsweredAt,
		AcknowledgedAt: question.AcknowledgedAt, NotifiedExpiringAt: question.NotifiedExpiringAt,
		CanceledAt: question.CanceledAt, CreatedAt: question.CreatedAt, UpdatedAt: question.UpdatedAt,
		Body: question.Body, Status: question.Status,
	}
}

func runNotify(ctx context.Context, root string, command string, payload []byte, environment []string, extra map[string]string) (string, error) {
	timeout, cancel := context.WithTimeout(ctx, notifyTimeout)
	defer cancel()
	child := exec.CommandContext(timeout, "sh", "-c", command)
	child.Dir = root
	child.Stdin = bytes.NewReader(payload)
	child.Stdout = io.Discard
	var stderr bytes.Buffer
	child.Stderr = &stderr
	child.Env = notifyEnvironment(environment, extra)
	err := child.Run()
	if timeout.Err() == context.DeadlineExceeded {
		return fmt.Sprintf("notify command failed: expected to finish within %dms, actual timed out", notifyTimeout.Milliseconds()), nil
	}
	if err == nil {
		return "", nil
	}
	exitCode := -1
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		exitCode = exitError.ExitCode()
	}
	detail := strings.TrimSpace(stderr.String())
	if detail == "" {
		return fmt.Sprintf("notify command failed: expected exit code 0, actual %d", exitCode), nil
	}
	return fmt.Sprintf("notify command failed: expected exit code 0, actual %d: %s", exitCode, detail), nil
}

func notifyEnvironment(base []string, extra map[string]string) []string {
	environment := make([]string, 0, len(base)+len(extra))
	for _, entry := range base {
		name, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if _, replaced := extra[name]; replaced {
			continue
		}
		environment = append(environment, entry)
	}
	for name, value := range extra {
		environment = append(environment, name+"="+value)
	}
	return environment
}

// EncodeURIComponent は JS の encodeURIComponent。残す文字は A-Z a-z 0-9 と - _ . ! ~ * ' ( )
// hintBoard (src/index.ts:741) と questionUrl (src/notify.ts:41) の両方が使う
func EncodeURIComponent(value string) string {
	var builder strings.Builder
	for _, character := range value {
		if isURIUnescaped(character) {
			builder.WriteRune(character)
			continue
		}
		var encoded [utf8.UTFMax]byte
		count := utf8.EncodeRune(encoded[:], character)
		for index := 0; index < count; index++ {
			fmt.Fprintf(&builder, "%%%02X", encoded[index])
		}
	}
	return builder.String()
}

func isURIUnescaped(character rune) bool {
	if character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
		return true
	}
	switch character {
	case '-', '_', '.', '!', '~', '*', '\'', '(', ')':
		return true
	default:
		return false
	}
}
