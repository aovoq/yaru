// エラーの文は TS 版のまま。コードは docs/spec/routes.md の「エラーコード」。
// issue とコメントは not found を含む文だけ NotFound。質問の衝突は Aborted、
// 取り消しの期限切れは FailedPrecondition。src/web.tsx:84-97 、src/questions.ts:274-303 。
//
//declscope:core
package api

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
)

func connectError(err error) error {
	if err == nil {
		return nil
	}
	code := connect.CodeInvalidArgument
	if strings.Contains(err.Error(), "not found") {
		code = connect.CodeNotFound
	}
	return connect.NewError(code, errors.New(err.Error()))
}

func invalidArgument(message string) error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New(message))
}

// connectStatus は質問の失敗を分ける。衝突は Aborted、期限切れの取り消しは FailedPrecondition。
// details の QuestionConflict には、そのとき保存されている質問を入れる。
func connectStatus(err error, question *yaruv1.Question) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	code := connect.CodeInvalidArgument
	switch {
	case failedPrecondition(message):
		code = connect.CodeFailedPrecondition
	case isQuestionConflict(err):
		code = connect.CodeAborted
	case strings.Contains(message, "not found"):
		code = connect.CodeNotFound
		question = nil
	}
	status := connect.NewError(code, errors.New(message))
	if question != nil && (code == connect.CodeAborted || code == connect.CodeFailedPrecondition) {
		detail, detailErr := connect.NewErrorDetail(&yaruv1.QuestionConflict{Question: question})
		if detailErr == nil {
			status.AddDetail(detail)
		}
	}
	return status
}

func isQuestionConflict(err error) bool {
	var conflict *questions.QuestionConflictError
	return errors.As(err, &conflict)
}

func failedPrecondition(message string) bool {
	return strings.Contains(message, "picked up at") ||
		strings.Contains(message, "expected within") ||
		strings.Contains(message, "late answer already added")
}

// questionFailure は QuestionConflict の質問を details に載せる。
// 期限超過と、コメントへ写したあとの取り消しは、エラーに質問が付かないので読み直す。
func questionFailure(ctx context.Context, directory questions.Directory, id string, moment time.Time, err error) error {
	question, convertErr := conflictQuestion(err)
	if convertErr != nil {
		return connectStatus(convertErr, nil)
	}
	if question == nil && failedPrecondition(err.Error()) {
		loaded, loadErr := questions.NewService().GetQuestion(ctx, directory, id, moment)
		if loadErr == nil {
			converted, convertedErr := questionMessage(loaded)
			if convertedErr == nil {
				question = converted
			}
		}
	}
	return connectStatus(err, question)
}

func conflictQuestion(err error) (*yaruv1.Question, error) {
	var conflict *questions.QuestionConflictError
	if !errors.As(err, &conflict) {
		return nil, nil
	}
	return questionMessage(conflict.Question)
}
