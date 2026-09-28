//declscope:namespace cli

// 中身の処理は別パッケージを呼ぶ。テストは services を差し替える
package cli

import (
	"io"
	"net/http"
	"os"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/notify"
	"github.com/aovoq/yaru/internal/provenance"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/server"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

// services は CLI が呼ぶ関数。nil の項目は本番のパッケージに向ける
// workspace.Register は slug を返さない。URL には workspace.Slug(root string) (string, error) が要る
type services struct {
	now                      func() (time.Time, error)
	workingDirectory         func() (string, error)
	init                     func(workingDirectory string) (workspace.Workspace, error)
	open                     func(workingDirectory string) (workspace.Workspace, error)
	register                 func(opened workspace.Workspace) error
	findSlug                 func(root string) (string, error)
	ensureQuestionsDirectory func(opened workspace.Workspace) error
	listIssues               func(opened workspace.Workspace, filter store.Filter) ([]store.Issue, error)
	pageIssues               func(issues []store.Issue, limit *int, cursor *string) (store.IssuePage, error)
	getIssue                 func(opened workspace.Workspace, issueID string) (store.Issue, error)
	saveIssue                func(opened workspace.Workspace, input store.SaveInput, options store.SaveOptions) (store.Issue, error)
	listComments             func(opened workspace.Workspace, issueID string) ([]store.Comment, error)
	getComment               func(opened workspace.Workspace, commentID string) (store.Comment, error)
	saveComment              func(opened workspace.Workspace, input store.SaveCommentInput) (store.Comment, error)
	listQuestions            func(opened workspace.Workspace, filter questions.Filter) ([]questions.Question, error)
	getQuestion              func(opened workspace.Workspace, questionID string) (questions.Question, error)
	acknowledgeQuestion      func(opened workspace.Workspace, questionID string) (questions.Question, error)
	saveQuestion             func(opened workspace.Workspace, input questions.SaveInput) (questions.Question, error)
	answerQuestion           func(opened workspace.Workspace, questionID string, input questions.AnswerInput) (questions.Question, error)
	readProvenance           func(workingDirectory string, environment []string) provenance.Provenance
	baseURL                  func(opened workspace.Workspace, fallback string) (string, error)
	questionURL              func(baseURL string, slug string, questionID string) string
	notifyQuestionCreated    func(opened workspace.Workspace, url string, question questions.Question) (string, error)
	serve                    func(port int) error
	monotonic                func() time.Time
	sleep                    func(time.Duration)
	fetchIssue               func(url string) (bool, error)
}

func defaultServices() services {
	return services{}.withDefaults()
}

func (active services) withDefaults() services {
	if active.now == nil {
		active.now = clock.Now
	}
	if active.workingDirectory == nil {
		active.workingDirectory = workspace.WorkingDirectory
	}
	if active.init == nil {
		active.init = workspace.Init
	}
	if active.open == nil {
		active.open = workspace.Open
	}
	if active.register == nil {
		active.register = workspace.Register
	}
	if active.findSlug == nil {
		active.findSlug = func(string) (string, error) {
			panic("not implemented: workspace.Slug")
		}
	}
	if active.ensureQuestionsDirectory == nil {
		active.ensureQuestionsDirectory = questions.EnsureDirectory
	}
	if active.listIssues == nil {
		active.listIssues = store.List
	}
	if active.pageIssues == nil {
		active.pageIssues = store.Page
	}
	if active.getIssue == nil {
		active.getIssue = store.Get
	}
	if active.saveIssue == nil {
		active.saveIssue = store.Save
	}
	if active.listComments == nil {
		active.listComments = store.ListComments
	}
	if active.getComment == nil {
		active.getComment = store.GetComment
	}
	if active.saveComment == nil {
		active.saveComment = store.SaveComment
	}
	if active.listQuestions == nil {
		active.listQuestions = questions.List
	}
	if active.getQuestion == nil {
		active.getQuestion = questions.Get
	}
	if active.acknowledgeQuestion == nil {
		active.acknowledgeQuestion = questions.Acknowledge
	}
	if active.saveQuestion == nil {
		active.saveQuestion = questions.Save
	}
	if active.answerQuestion == nil {
		active.answerQuestion = questions.Answer
	}
	if active.readProvenance == nil {
		active.readProvenance = provenance.Read
	}
	if active.baseURL == nil {
		active.baseURL = notify.BaseURL
	}
	if active.questionURL == nil {
		active.questionURL = notify.QuestionURL
	}
	if active.notifyQuestionCreated == nil {
		active.notifyQuestionCreated = notify.QuestionCreated
	}
	if active.serve == nil {
		active.serve = server.Serve
	}
	if active.monotonic == nil {
		// question wait の経過時間。YARU_NOW で止めた時刻だと timeout が来ない
		// src/index.ts:661 performance.now()
		// https://www.w3.org/TR/hr-time-3/#dom-performance-now
		active.monotonic = time.Now
	}
	if active.sleep == nil {
		active.sleep = time.Sleep
	}
	if active.fetchIssue == nil {
		active.fetchIssue = fetchIssueOK
	}
	return active
}

func (active services) openWorkspace() (workspace.Workspace, error) {
	directory, err := active.workingDirectory()
	if err != nil {
		return workspace.Workspace{}, err
	}
	opened, err := active.open(directory)
	if err != nil {
		return workspace.Workspace{}, err
	}
	if err := active.register(opened); err != nil {
		return workspace.Workspace{}, err
	}
	return opened, nil
}

// fetchIssueOK は src/index.ts:742-746。200ms で諦め、2xx だけ成功
func fetchIssueOK(url string) (bool, error) {
	client := http.Client{Timeout: 200 * time.Millisecond}
	response, err := client.Get(url)
	if err != nil {
		return false, err
	}
	defer func() { _ = response.Body.Close() }()
	if _, err := io.Copy(io.Discard, response.Body); err != nil {
		return false, err
	}
	return response.StatusCode >= 200 && response.StatusCode < 300, nil
}

func processEnvironment(environment []string) []string {
	if environment != nil {
		return environment
	}
	return os.Environ()
}
