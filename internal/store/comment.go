//declscope:namespace issue

// コメントの読み書き。パスは .yaru/comments/<id>.md
// TS 版の src/store.ts:648-765。仕様は docs/spec/yaru-format.md の「comment」
// 時刻と作者は引数で受け取る。JSON は document、issue の検査は GetIssue を使う
package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/fsutil"
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

// ListComments は issue のコメントを createdAt、同じなら id の順で返す
// 壊れたファイルは 1 件だけ省く。issue 自体が読めなければ一覧全体が失敗する
// docs/spec/yaru-format.md の「comment」。src/store.ts:648-652, src/store.ts:707-719
func ListComments(ctx context.Context, space workspace.Workspace, issueID string, now time.Time, author string) ([]Comment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if _, err := GetIssue(ctx, space, issueID, now, author); err != nil {
		return nil, err
	}
	comments, err := commentLoad(space.Directory, author)
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
// 壊れていても省かない。空の author は引数の作者に置き換える。ファイルは書き換えない。
// src/store.ts:655-658、src/store.ts:746
func GetComment(ctx context.Context, space workspace.Workspace, commentID string, author string) (Comment, error) {
	if err := ctx.Err(); err != nil {
		return Comment{}, err
	}
	comment, err := commentRead(commentPath(space.Directory, commentID), commentID, author)
	if errors.Is(err, os.ErrNotExist) {
		return Comment{}, issueErrString(fmt.Sprintf("comment not found: %s", commentID))
	}
	return comment, err
}

// SaveComment は作成するか、id があれば本文を更新する
// 時刻は引数 now の ISO 文字列。空の author は引数の作者に置き換える。src/store.ts:661-704
// 更新はコメントファイル、作成は comments ディレクトリをロックする。
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
func SaveComment(ctx context.Context, space workspace.Workspace, input SaveCommentInput, now time.Time, author string) (Comment, error) {
	if err := ctx.Err(); err != nil {
		return Comment{}, err
	}
	timestamp := clock.ISOString(now)
	if input.ID != nil && *input.ID != "" {
		return commentUpdate(ctx, space, *input.ID, input.Body, timestamp, author)
	}
	return commentCreate(ctx, space, input, now, timestamp, author)
}

func commentUpdate(ctx context.Context, space workspace.Workspace, commentID string, body *string, timestamp string, author string) (Comment, error) {
	path := commentPath(space.Directory, commentID)
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Comment{}, issueErrString(fmt.Sprintf("comment not found: %s", commentID))
		}
		return Comment{}, err
	}
	unlock, err := fsutil.Lock(ctx, path)
	if err != nil {
		return Comment{}, err
	}
	defer unlock()
	current, err := commentRead(path, commentID, author)
	if errors.Is(err, os.ErrNotExist) {
		return Comment{}, issueErrString(fmt.Sprintf("comment not found: %s", commentID))
	}
	if err != nil {
		return Comment{}, err
	}
	if body != nil && document.Trim(*body) == "" {
		return Comment{}, commentInvalidBody(*body)
	}
	if body != nil {
		current.Body = *body
	}
	current.UpdatedAt = timestamp
	if err := fsutil.WriteReplace(path, commentFormat(current)); err != nil {
		return Comment{}, err
	}
	return current, nil
}

func commentCreate(ctx context.Context, space workspace.Workspace, input SaveCommentInput, now time.Time, timestamp string, author string) (Comment, error) {
	commentsDirectory := filepath.Join(space.Directory, "comments")
	unlock, err := fsutil.Lock(ctx, commentsDirectory)
	if err != nil {
		return Comment{}, err
	}
	defer unlock()
	var parent *Comment
	if input.Parent != nil && *input.Parent != "" {
		found, readErr := commentRead(commentPath(space.Directory, *input.Parent), *input.Parent, author)
		if errors.Is(readErr, os.ErrNotExist) {
			return Comment{}, issueErrString(fmt.Sprintf("comment not found: %s", *input.Parent))
		}
		if readErr != nil {
			return Comment{}, readErr
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
		return Comment{}, issueErrString("issue is required when creating a comment")
	}
	// getIssue は staleAfter を先に見て、issue の形が壊れていれば作成しない
	// src/store.ts:236-237, src/store.ts:681
	if _, err := GetIssue(ctx, space, issueID, now, author); err != nil {
		return Comment{}, err
	}
	body := ""
	if input.Body != nil {
		body = *input.Body
	}
	if document.Trim(body) == "" {
		return Comment{}, commentInvalidBody(body)
	}
	if err := commentMkdir(commentsDirectory); err != nil {
		return Comment{}, err
	}
	var created Comment
	_, err = commentCreateWithRetry(space.Directory, func(commentID string) (string, error) {
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

func commentInvalidBody(value string) error {
	encoded, err := document.Quote(value)
	if err != nil {
		return err
	}
	return issueErrString(fmt.Sprintf("invalid body: expected a non-empty string, actual %s", encoded))
}

func commentLoad(directory string, author string) ([]Comment, error) {
	commentsDirectory := filepath.Join(directory, "comments")
	names, err := fsutil.ReadDir(commentsDirectory)
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
		comment, readErr := commentRead(filepath.Join(commentsDirectory, name), strings.TrimSuffix(name, ".md"), author)
		if readErr != nil {
			continue
		}
		comments = append(comments, comment)
	}
	return comments, nil
}

func commentRead(path string, stem string, author string) (Comment, error) {
	text, err := commentReadFile(path)
	if err != nil {
		return Comment{}, err
	}
	parsed, err := document.Parse(text)
	if err != nil {
		// parseFrontmatter の失敗は、コメントでも invalid issue file。src/store.ts:790-791
		return Comment{}, err
	}
	issueID := document.Trim(parsed.Meta["issue"])
	if issueID == "" {
		return Comment{}, issueErrString("invalid comment file")
	}
	commentAuthor := document.Trim(parsed.Meta["author"])
	if commentAuthor == "" {
		commentAuthor = author
	}
	return Comment{
		ID:        stem,
		Issue:     issueID,
		Parent:    commentBlankToNull(parsed.Meta["parent"]),
		Author:    commentAuthor,
		CreatedAt: document.Trim(parsed.Meta["createdAt"]),
		UpdatedAt: document.Trim(parsed.Meta["updatedAt"]),
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
	names, err := fsutil.ReadDir(filepath.Join(directory, "comments"))
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
		number, ok := document.ParseNumber(match[1])
		if !ok || number <= maximum {
			continue
		}
		maximum = number
	}
	return document.FormatNumber(maximum + 1), nil
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
	return fsutil.WriteCreate(path, text)
}

func commentReplace(path string, text string) error {
	return fsutil.WriteReplace(path, text)
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
		character, size := utf8.DecodeRune(content)
		builder.WriteRune(character)
		content = content[size:]
	}
	return builder.String()
}

func commentBlankToNull(value string) *string {
	return BlankToNull(Present(value)).Value
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
