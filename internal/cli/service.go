//declscope:namespace cli

// 中身の処理は別パッケージを呼ぶ。テストは services を差し替える
package cli

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/notify"
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
		active.now = currentTime
	}
	if active.workingDirectory == nil {
		active.workingDirectory = func() (string, error) {
			return workspace.WorkingDirectory(context.Background())
		}
	}
	if active.init == nil {
		active.init = func(workingDirectory string) (workspace.Workspace, error) {
			return workspace.Init(context.Background(), workingDirectory)
		}
	}
	if active.open == nil {
		active.open = func(workingDirectory string) (workspace.Workspace, error) {
			return workspace.Open(context.Background(), workingDirectory)
		}
	}
	if active.register == nil {
		active.register = func(opened workspace.Workspace) error {
			return workspace.Register(context.Background(), opened, stateDirectory())
		}
	}
	if active.findSlug == nil {
		active.findSlug = func(root string) (string, error) {
			return workspace.Slug(context.Background(), root, stateDirectory())
		}
	}
	if active.ensureQuestionsDirectory == nil {
		active.ensureQuestionsDirectory = ensureQuestionsDirectory
	}
	if active.listIssues == nil {
		active.listIssues = func(opened workspace.Workspace, filter store.Filter) ([]store.Issue, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return nil, err
			}
			return store.ListIssues(context.Background(), opened, filter, moment, author)
		}
	}
	if active.pageIssues == nil {
		active.pageIssues = func(issues []store.Issue, limit any, cursor *string) (store.IssuePage, error) {
			return store.PageIssues(issues, store.PageOptions{Limit: limit, Cursor: cursor})
		}
	}
	if active.getIssue == nil {
		active.getIssue = func(opened workspace.Workspace, issueID string) (store.Issue, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return store.Issue{}, err
			}
			return store.GetIssue(context.Background(), opened, issueID, moment, author)
		}
	}
	if active.saveIssue == nil {
		active.saveIssue = func(opened workspace.Workspace, input store.SaveInput, options store.SaveOptions) (store.Issue, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return store.Issue{}, err
			}
			if options.Now.IsZero() {
				options.Now = moment
			}
			if options.Author == "" {
				options.Author = author
			}
			return store.SaveIssue(context.Background(), opened, input, options)
		}
	}
	if active.listComments == nil {
		active.listComments = func(opened workspace.Workspace, issueID string) ([]store.Comment, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return nil, err
			}
			return store.ListComments(context.Background(), opened, issueID, moment, author)
		}
	}
	if active.getComment == nil {
		active.getComment = func(opened workspace.Workspace, commentID string) (store.Comment, error) {
			_, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return store.Comment{}, err
			}
			return store.GetComment(context.Background(), opened, commentID, author)
		}
	}
	if active.saveComment == nil {
		active.saveComment = func(opened workspace.Workspace, input store.SaveCommentInput) (store.Comment, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return store.Comment{}, err
			}
			return store.SaveComment(context.Background(), opened, input, moment, author)
		}
	}
	questionService := questions.NewService()
	if active.listQuestions == nil {
		active.listQuestions = func(opened workspace.Workspace, filter questions.QuestionFilter) ([]questions.Question, error) {
			moment, err := active.now()
			if err != nil {
				return nil, err
			}
			return questionService.ListQuestions(context.Background(), questions.Directory{Dir: opened.Directory}, filter, moment)
		}
	}
	if active.getQuestion == nil {
		active.getQuestion = func(opened workspace.Workspace, questionID string) (questions.Question, error) {
			moment, err := active.now()
			if err != nil {
				return questions.Question{}, err
			}
			return questionService.GetQuestion(context.Background(), questions.Directory{Dir: opened.Directory}, questionID, moment)
		}
	}
	if active.acknowledgeQuestion == nil {
		active.acknowledgeQuestion = func(opened workspace.Workspace, questionID string) (questions.Question, error) {
			moment, err := active.now()
			if err != nil {
				return questions.Question{}, err
			}
			return questionService.AcknowledgeQuestion(context.Background(), questions.Directory{Dir: opened.Directory}, questionID, moment)
		}
	}
	if active.saveQuestion == nil {
		active.saveQuestion = func(opened workspace.Workspace, input questions.SaveInput) (questions.Question, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return questions.Question{}, err
			}
			return questionService.SaveQuestion(context.Background(), questions.Directory{Dir: opened.Directory}, storeIssues{}, input, moment, author)
		}
	}
	if active.answerQuestion == nil {
		active.answerQuestion = func(opened workspace.Workspace, questionID string, input questions.AnswerInput) (questions.Question, error) {
			moment, author, err := momentAndAuthor(active, opened)
			if err != nil {
				return questions.Question{}, err
			}
			return questionService.AnswerQuestion(context.Background(), questions.Directory{Dir: opened.Directory}, storeIssues{}, questionID, input, moment, author)
		}
	}
	if active.readProvenance == nil {
		active.readProvenance = readWorkspaceProvenance
	}
	if active.baseURL == nil {
		active.baseURL = func(opened workspace.Workspace, fallback string) (string, error) {
			return notify.BaseURL(context.Background(), opened, fallback)
		}
	}
	if active.questionURL == nil {
		active.questionURL = notify.QuestionURL
	}
	if active.notifyQuestionCreated == nil {
		active.notifyQuestionCreated = func(opened workspace.Workspace, url string, question questions.Question) (string, error) {
			return notify.QuestionCreated(context.Background(), opened, url, question, os.Environ())
		}
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

func ensureQuestionsDirectory(opened workspace.Workspace) error {
	_, err := questions.NewService().EnsureQuestionsDirectory(context.Background(), questions.Directory{Dir: opened.Directory})
	return err
}

// storeIssues は質問が issue の有無と、期限後の回答コメントを store に頼るときの橋
// src/questions.ts:580-584 src/questions.ts:236-245
type storeIssues struct{}

func (storeIssues) GetIssue(ctx context.Context, directory questions.Directory, issueID string, now time.Time, author string) error {
	_, err := store.GetIssue(ctx, workspace.Workspace{Root: filepath.Dir(directory.Dir), Directory: directory.Dir}, issueID, now, author)
	return err
}

func (storeIssues) SaveComment(ctx context.Context, directory questions.Directory, issueID string, body string, now time.Time, author string) error {
	_, err := store.SaveComment(ctx, workspace.Workspace{Root: filepath.Dir(directory.Dir), Directory: directory.Dir}, store.SaveCommentInput{Issue: &issueID, Body: &body}, now, author)
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
	return workspace.ReadProvenance(context.Background(), workingDirectory, mapped)
}

// currentTime は YARU_NOW を読む唯一の場所のひとつ。空では無い値だけ固定し、未設定なら今。
// src/time.ts:43-45
func currentTime() (time.Time, error) {
	value, exists := os.LookupEnv("YARU_NOW")
	if !exists {
		return time.Now(), nil
	}
	return clock.ParseYaruNow(value)
}

func stateDirectory() string {
	return workspace.StateDirectory(os.Getenv("YARU_STATE_DIR"), os.Getenv("XDG_STATE_HOME"), homeDirectory())
}

func homeDirectory() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	current, err := user.Current()
	if err != nil {
		return ""
	}
	return current.HomeDir
}

func momentAndAuthor(active services, opened workspace.Workspace) (time.Time, string, error) {
	moment, err := active.now()
	if err != nil {
		return time.Time{}, "", err
	}
	return moment, workspace.GitName(context.Background(), opened.Root), nil
}

func processEnvironment(environment []string) []string {
	if environment != nil {
		return environment
	}
	return os.Environ()
}
