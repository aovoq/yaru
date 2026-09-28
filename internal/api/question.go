//declscope:core
package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/questions"
)

// questionService は質問の読み、回答、取り消し、取り下げ。作成と acknowledge は RPC にしない。
// proto/yaru/v1/question.proto 。src/web.tsx:221-247 、src/web.tsx:174-195 。
type questionService struct {
	stateDirectory string
}

func (service *questionService) ListQuestions(ctx context.Context, request *connect.Request[yaruv1.ListQuestionsRequest]) (*connect.Response[yaruv1.ListQuestionsResponse], error) {
	moment, err := clock.Now()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	filter := questions.QuestionFilter{}
	if request.Msg.Status != nil {
		statusName, statusErr := questionStatusInput(*request.Msg.Status, "status")
		if statusErr != nil {
			return nil, connectStatus(statusErr, nil)
		}
		if statusName != "" {
			filter.Status = &statusName
		}
	}
	if request.Msg.Issue != nil && *request.Msg.Issue != "" {
		filter.Issue = *request.Msg.Issue
	}
	listed, err := questions.ListQuestions(questionDirectory(opened), filter, &moment)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	converted, err := protoQuestions(listed)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.ListQuestionsResponse{
		Questions: converted,
		Now:       clock.ISOString(moment),
	}), nil
}

func (service *questionService) GetQuestion(ctx context.Context, request *connect.Request[yaruv1.GetQuestionRequest]) (*connect.Response[yaruv1.GetQuestionResponse], error) {
	moment, err := clock.Now()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	question, err := questions.GetQuestion(questionDirectory(opened), request.Msg.GetId(), &moment)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	converted, err := protoQuestion(question)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.GetQuestionResponse{
		Question: converted,
		Now:      clock.ISOString(moment),
	}), nil
}

func (service *questionService) AnswerQuestion(ctx context.Context, request *connect.Request[yaruv1.AnswerQuestionRequest]) (*connect.Response[yaruv1.AnswerQuestionResponse], error) {
	moment, err := clock.Now()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	input := questions.AnswerInput{}
	if request.Msg.Body != nil {
		body := request.Msg.GetBody()
		input.Body = &body
	}
	if request.Msg.ExpectedStatus != nil {
		statusName, statusErr := questionStatusInput(*request.Msg.ExpectedStatus, "expectedStatus")
		if statusErr != nil {
			return nil, connectStatus(statusErr, nil)
		}
		if statusName != "" {
			input.ExpectedStatus = &statusName
		}
	}
	if request.Msg.GetForce() {
		input.Force = true
	}
	directory := questionDirectory(opened)
	saved, err := questions.AnswerQuestion(directory, storeIssues{space: opened}, request.Msg.GetId(), input, &moment)
	if err != nil {
		return nil, questionFailure(directory, request.Msg.GetId(), &moment, err)
	}
	converted, err := protoQuestion(saved)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.AnswerQuestionResponse{
		Question: converted,
		Now:      clock.ISOString(moment),
	}), nil
}

func (service *questionService) UndoAnswer(ctx context.Context, request *connect.Request[yaruv1.UndoAnswerRequest]) (*connect.Response[yaruv1.UndoAnswerResponse], error) {
	moment, err := clock.Now()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	input := questions.UndoInput{}
	if request.Msg.AnsweredAt != nil {
		answeredAt := request.Msg.GetAnsweredAt()
		input.AnsweredAt = &answeredAt
	}
	directory := questionDirectory(opened)
	saved, err := questions.UndoAnswer(directory, request.Msg.GetId(), input, &moment)
	if err != nil {
		return nil, questionFailure(directory, request.Msg.GetId(), &moment, err)
	}
	converted, err := protoQuestion(saved)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.UndoAnswerResponse{
		Question: converted,
		Now:      clock.ISOString(moment),
	}), nil
}

func (service *questionService) CancelQuestion(ctx context.Context, request *connect.Request[yaruv1.CancelQuestionRequest]) (*connect.Response[yaruv1.CancelQuestionResponse], error) {
	moment, err := clock.Now()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	directory := questionDirectory(opened)
	saved, err := questions.CancelQuestion(directory, request.Msg.GetId(), &moment)
	if err != nil {
		return nil, questionFailure(directory, request.Msg.GetId(), &moment, err)
	}
	converted, err := protoQuestion(saved)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.CancelQuestionResponse{
		Question: converted,
		Now:      clock.ISOString(moment),
	}), nil
}

// questionStatusInput は未設定を「絞らない」にする。未知の数値は InvalidArgument。
// docs/spec/routes.md の「列挙」。src/questions.ts:499-515 。
func questionStatusInput(status yaruv1.QuestionStatus, name string) (string, error) {
	switch status {
	case yaruv1.QuestionStatus_QUESTION_STATUS_UNSPECIFIED:
		return "", nil
	case yaruv1.QuestionStatus_QUESTION_STATUS_OPEN:
		return "open", nil
	case yaruv1.QuestionStatus_QUESTION_STATUS_EXPIRED:
		return "expired", nil
	case yaruv1.QuestionStatus_QUESTION_STATUS_ANSWERED:
		return "answered", nil
	case yaruv1.QuestionStatus_QUESTION_STATUS_CANCELED:
		return "canceled", nil
	default:
		return "", fmt.Errorf("invalid %s: expected open, expired, answered, or canceled, actual %d", name, status)
	}
}
