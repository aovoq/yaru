//declscope:namespace cli

// 中身の処理は別パッケージを呼ぶ。テストは services を差し替える
package cli

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aovoq/yaru/internal/api"
	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/server"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

// services は CLI が呼ぶ関数。nil の項目は本番のパッケージに向ける
type services struct {
	now                      func() (time.Time, error)
	workingDirectory         func() (string, error)
	init                     func(workingDirectory string) (workspace.Workspace, error)
	open                     func(workingDirectory string) (workspace.Workspace, error)
	register                 func(opened workspace.Workspace) error
	findSlug                 func(root string) (string, error)
	ensureQuestionsDirectory func(opened workspace.Workspace) error
	listIssues               func(opened workspace.Workspace, filter store.Filter) ([]store.Issue, error)
	pageIssues               func(issues []store.Issue, limit any, cursor *string) (store.IssuePage, error)
	getIssue                 func(opened workspace.Workspace, issueID string) (store.Issue, error)
	saveIssue                func(opened workspace.Workspace, input store.SaveInput, options store.SaveOptions) (store.Issue, error)
	listComments             func(opened workspace.Workspace, issueID string) ([]store.Comment, error)
	getComment               func(opened workspace.Workspace, commentID string) (store.Comment, error)
	saveComment              func(opened workspace.Workspace, input store.SaveCommentInput) (store.Comment, error)
	listQuestions            func(opened workspace.Workspace, filter questions.QuestionFilter) ([]questions.Question, error)
	getQuestion              func(opened workspace.Workspace, questionID string) (questions.Question, error)
	acknowledgeQuestion      func(opened workspace.Workspace, questionID string) (questions.Question, error)
	saveQuestion             func(opened workspace.Workspace, input questions.SaveInput) (questions.Question, error)
	answerQuestion           func(opened workspace.Workspace, questionID string, input questions.AnswerInput) (questions.Question, error)
	readProvenance           func(workingDirectory string, environment []string) (workspace.Provenance, error)
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
		active.findSlug = workspace.Slug
	}
	if active.ensureQuestionsDirectory == nil {
		active.ensureQuestionsDirectory = ensureQuestionsDirectory
	}
	if active.listIssues == nil {
		active.listIssues = func(opened workspace.Workspace, filter store.Filter) ([]store.Issue, error) {
			return store.ListIssues(opened, filter, nil)
		}
	}
	if active.pageIssues == nil {
		active.pageIssues = func(issues []store.Issue, limit any, cursor *string) (store.IssuePage, error) {
			return store.PageIssues(issues, store.PageOptions{Limit: limit, Cursor: cursor})
		}
	}
	if active.getIssue == nil {
		active.getIssue = func(opened workspace.Workspace, issueID string) (store.Issue, error) {
			return store.GetIssue(opened, issueID, nil)
		}
	}
	if active.saveIssue == nil {
		active.saveIssue = store.SaveIssue
	}
	if active.listComments == nil {
		active.listComments = func(opened workspace.Workspace, issueID string) ([]store.Comment, error) {
			return store.ListComments(opened.Directory, issueID)
		}
	}
	if active.getComment == nil {
		active.getComment = func(opened workspace.Workspace, commentID string) (store.Comment, error) {
			return store.GetComment(opened.Directory, commentID)
		}
	}
	if active.saveComment == nil {
		active.saveComment = func(opened workspace.Workspace, input store.SaveCommentInput) (store.Comment, error) {
			return store.SaveComment(opened.Directory, input)
		}
	}
	if active.listQuestions == nil {
		active.listQuestions = func(opened workspace.Workspace, filter questions.QuestionFilter) ([]questions.Question, error) {
			return questions.ListQuestions(questions.Directory{Dir: opened.Directory}, filter, nil)
		}
	}
	if active.getQuestion == nil {
		active.getQuestion = func(opened workspace.Workspace, questionID string) (questions.Question, error) {
			return questions.GetQuestion(questions.Directory{Dir: opened.Directory}, questionID, nil)
		}
	}
	if active.acknowledgeQuestion == nil {
		active.acknowledgeQuestion = func(opened workspace.Workspace, questionID string) (questions.Question, error) {
			return questions.AcknowledgeQuestion(questions.Directory{Dir: opened.Directory}, questionID, nil)
		}
	}
	if active.saveQuestion == nil {
		active.saveQuestion = func(opened workspace.Workspace, input questions.SaveInput) (questions.Question, error) {
			return questions.SaveQuestion(questions.Directory{Dir: opened.Directory}, storeIssues{}, input, nil)
		}
	}
	if active.answerQuestion == nil {
		active.answerQuestion = func(opened workspace.Workspace, questionID string, input questions.AnswerInput) (questions.Question, error) {
			return questions.AnswerQuestion(questions.Directory{Dir: opened.Directory}, storeIssues{}, questionID, input, nil)
		}
	}
	if active.readProvenance == nil {
		active.readProvenance = readWorkspaceProvenance
	}
	if active.baseURL == nil {
		active.baseURL = notifyBaseURL
	}
	if active.questionURL == nil {
		active.questionURL = api.QuestionURL
	}
	if active.notifyQuestionCreated == nil {
		active.notifyQuestionCreated = notifyQuestionCreated
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

func notifyBaseURL(opened workspace.Workspace, fallback string) (string, error) {
	return api.BaseURL(opened, fallback), nil
}

func notifyQuestionCreated(opened workspace.Workspace, url string, question questions.Question) (string, error) {
	// 子の環境は api.Notify の許可リスト。親の環境は渡さない。
	// docs/spec/security.md の「知らせコマンド」と「決定」
	return api.Notify(opened, api.Event{
		Name:     "question.created",
		URL:      url,
		Question: &question,
	})
}

func ensureQuestionsDirectory(opened workspace.Workspace) error {
	_, err := questions.EnsureQuestionsDirectory(questions.Directory{Dir: opened.Directory})
	return err
}

// storeIssues は質問が issue の有無と、期限後の回答コメントを store に頼るときの橋
// src/questions.ts:580-584 src/questions.ts:236-245
type storeIssues struct{}

func (storeIssues) GetIssue(directory questions.Directory, issueID string) error {
	_, err := store.GetIssue(workspace.Workspace{Root: filepath.Dir(directory.Dir), Directory: directory.Dir}, issueID, nil)
	return err
}

func (storeIssues) SaveComment(directory questions.Directory, issueID string, body string) error {
	_, err := store.SaveComment(directory.Dir, store.SaveCommentInput{Issue: &issueID, Body: &body})
	return err
}

func readWorkspaceProvenance(workingDirectory string, environment []string) (workspace.Provenance, error) {
	mapped := map[string]string{}
	for _, entry := range environment {
		name, value, found := strings.Cut(entry, "=")
		if found {
			mapped[name] = value
		}
	}
	return workspace.ReadProvenance(workingDirectory, mapped)
}

func processEnvironment(environment []string) []string {
	if environment != nil {
		return environment
	}
	return os.Environ()
}
