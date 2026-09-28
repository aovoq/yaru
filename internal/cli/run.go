//declscope:namespace cli

// コマンドの振り分け。TS 版の src/index.ts の main、issue、comment、question
package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/aovoq/yaru/internal/api"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/server"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

// Invocation は 1 回の CLI 実行。services が nil なら本番のパッケージを呼ぶ
type Invocation struct {
	Arguments   []string
	Stdin       io.Reader
	Stdout      io.Writer
	Stderr      io.Writer
	Environment []string
	services    *services
}

type commandFailure struct {
	message string
	code    int
}

func (failure *commandFailure) Error() string { return failure.message }

// Run は終了コードを返す。読めない YARU_NOW はファイルを書く前に止める
// src/index.ts:329-380
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
func Run(invocation Invocation) int {
	active := defaultServices()
	if invocation.services != nil {
		active = invocation.services.withDefaults()
	}
	standardOutput := invocation.Stdout
	standardError := invocation.Stderr
	if _, err := active.now(); err != nil {
		return writeFailure(standardError, err)
	}
	parsed, err := parseArguments(invocation.Arguments)
	if err != nil {
		return writeFailure(standardError, err)
	}
	if wantsHelp(parsed) {
		return writeText(standardOutput, helpFor(parsed.rest))
	}
	if len(parsed.rest) == 0 {
		if err := writeTextError(standardOutput, globalHelp()); err != nil {
			return 1
		}
		return 1
	}
	runner := runtime{
		stdout:      standardOutput,
		stderr:      standardError,
		stdin:       invocation.Stdin,
		environment: processEnvironment(invocation.Environment),
		services:    active,
	}
	if err := runner.dispatch(parsed); err != nil {
		return writeFailure(standardError, err)
	}
	return 0
}

func writeFailure(stderr io.Writer, err error) int {
	code := 1
	var failure *commandFailure
	if asCommandFailure(err, &failure) {
		code = failure.code
	}
	if _, writeErr := fmt.Fprintf(stderr, "%s\n", err.Error()); writeErr != nil {
		return code
	}
	return code
}

func asCommandFailure(err error, target **commandFailure) bool {
	failure, matched := err.(*commandFailure)
	if !matched {
		return false
	}
	*target = failure
	return true
}

func writeText(writer io.Writer, text string) int {
	if err := writeTextError(writer, text); err != nil {
		return 1
	}
	return 0
}

func writeTextError(writer io.Writer, text string) error {
	_, err := io.WriteString(writer, text)
	return err
}

type runtime struct {
	stdout      io.Writer
	stderr      io.Writer
	stdin       io.Reader
	environment []string
	services    services
}

func (runner runtime) dispatch(parsed parsedArguments) error {
	switch parsed.rest[0] {
	case "init":
		return runner.runInit(parsed)
	case "serve":
		return runner.runServe(parsed)
	case "issue":
		return runner.runIssue(parsed, parsed.rest[1:])
	case "comment":
		return runner.runComment(parsed, parsed.rest[1:])
	case "question":
		return runner.runQuestion(parsed, parsed.rest[1:])
	default:
		return &commandFailure{message: "unknown command: " + parsed.rest[0], code: 1}
	}
}

var initFlags = flagSet("help", "h")
var serveFlags = flagSet("help", "h", "port", "p")

// runInit は src/index.ts:346-352。位置引数は見ない。-hf も位置引数なので初期化は進む
func (runner runtime) runInit(parsed parsedArguments) error {
	if err := rejectUnknownFlag(parsed, initFlags); err != nil {
		return err
	}
	directory, err := runner.services.workingDirectory()
	if err != nil {
		return err
	}
	opened, err := runner.services.init(directory)
	if err != nil {
		return err
	}
	if err := runner.services.ensureQuestionsDirectory(opened); err != nil {
		return err
	}
	if err := runner.services.register(opened); err != nil {
		return err
	}
	_, err = fmt.Fprintf(runner.stdout, "initialized %s\n", opened.Directory)
	return err
}

// runServe は src/index.ts:354-361。ワークスペースでなくても起動する。位置引数は見ない
func (runner runtime) runServe(parsed parsedArguments) error {
	if err := rejectUnknownFlag(parsed, serveFlags); err != nil {
		return err
	}
	// 起動した場所がワークスペースでなければ登録しない。失敗は待受を止めない。src/index.ts:357-359
	_, _ = runner.services.openWorkspace()
	port, err := chosenPort(parsed)
	if err != nil {
		return err
	}
	return runner.services.serve(port)
}

var issueListFlags = flagSet("help", "h", "status", "assignee", "label", "query", "due", "parent", "limit", "cursor", "format", "f")
var issueGetFlags = flagSet("help", "h", "id", "format", "f")
var issueSaveFlags = flagSet("help", "h", "id", "title", "status", "assignee", "label", "dueDate", "priority", "parent", "block", "blockedBy", "removeBlock", "removeBlockedBy", "body", "patch", "format", "f")

func (runner runtime) runIssue(parsed parsedArguments, rest []string) error {
	subcommand := ""
	if len(rest) > 0 {
		subcommand = rest[0]
	}
	switch subcommand {
	case "list":
		return runner.issueList(parsed, rest)
	case "get":
		return runner.issueGet(parsed, rest)
	case "save":
		return runner.issueSave(parsed, rest)
	default:
		return &commandFailure{message: "usage: yaru issue list|get|save", code: 1}
	}
}

func (runner runtime) issueList(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, issueListFlags); err != nil {
		return err
	}
	if err := rejectExtra(rest[1:]); err != nil {
		return err
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	filter := store.Filter{}
	if value, present := parsed.flag("status"); present && value != "" {
		filter.Status = store.Present(value)
	}
	if value, present := parsed.flag("query"); present && value != "" {
		filter.Query = store.Present(value)
	}
	if value, present := parsed.flag("label"); present && value != "" {
		filter.Label = store.Present(value)
	}
	if value, present := parsed.flag("assignee"); present {
		filter.Assignee = store.Present(value)
	}
	if value, present := parsed.flag("parent"); present {
		if value == "none" {
			filter.Parent = store.Null[string]()
		} else {
			filter.Parent = store.Present(value)
		}
	}
	if value, present := parsed.flag("due"); present {
		if value != "overdue" {
			return &commandFailure{message: "invalid due: expected overdue, actual " + value, code: 1}
		}
		filter.Due = store.Present(value)
	}
	issues, err := runner.services.listIssues(opened, filter)
	if err != nil {
		return err
	}
	if issues == nil {
		issues = []store.Issue{}
	}
	limitValue, limitPresent := parsed.flag("limit")
	limit, err := parseLimit(limitValue, limitPresent)
	if err != nil {
		return err
	}
	var cursor *string
	if value, present := parsed.flag("cursor"); present {
		cursor = stringPointer(value)
	}
	page, err := runner.services.pageIssues(issues, limit, cursor)
	if err != nil {
		return err
	}
	if page.Issues == nil {
		page.Issues = []store.Issue{}
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireIssuePage(page))
	}
	_, err = io.WriteString(runner.stdout, formatIssueList(page.Issues))
	return err
}

func (runner runtime) issueGet(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, issueGetFlags); err != nil {
		return err
	}
	issueID, extra := positionalIdentifier(parsed, rest)
	if issueID == "" {
		return &commandFailure{message: "usage: yaru issue get <id>", code: 1}
	}
	if err := rejectExtra(extra); err != nil {
		return err
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	found, err := runner.services.getIssue(opened, issueID)
	if err != nil {
		return err
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireIssue(found))
	}
	_, err = io.WriteString(runner.stdout, formatIssue(found))
	return err
}

func (runner runtime) issueSave(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, issueSaveFlags); err != nil {
		return err
	}
	if err := rejectExtra(rest[1:]); err != nil {
		return err
	}
	_, bodyPresent := parsed.flag("body")
	_, patchPresent := parsed.flag("patch")
	if bodyPresent && patchPresent {
		return &commandFailure{message: "cannot pass body and patch together", code: 1}
	}
	input := store.SaveInput{}
	if value, present := parsed.flag("id"); present && value != "" {
		input.ID = value
	}
	if value, present := definedString(parsed, "title"); present {
		input.Title = store.Present(*value)
	}
	if value, present := definedString(parsed, "status"); present {
		input.Status = store.Present(*value)
	}
	body, err := readBody(parsed, runner.stdin)
	if err != nil {
		return err
	}
	if body != nil {
		input.Body = store.Present(*body)
	}
	patch, patchSet, err := readPatch(parsed, runner.stdin)
	if err != nil {
		return err
	}
	input.Patch = patch
	input.PatchSet = patchSet
	if values, present := parsed.values["label"]; present {
		input.Labels = store.Present(append([]string(nil), values...))
	}
	if value, present := definedString(parsed, "assignee"); present {
		input.Assignee = store.Present(*value)
	}
	if value, present := definedString(parsed, "dueDate"); present {
		input.DueDate = store.Present(*value)
	}
	if value, present := definedString(parsed, "priority"); present {
		input.Priority = store.Present(*value)
	}
	if value, present := definedString(parsed, "parent"); present {
		input.Parent = store.Present(*value)
	}
	if values := copyValues(parsed.values["block"]); values != nil {
		input.AddBlocks = store.Present(values)
	}
	if values := copyValues(parsed.values["blockedBy"]); values != nil {
		input.AddBlockedBy = store.Present(values)
	}
	if values := copyValues(parsed.values["removeBlock"]); values != nil {
		input.RemoveBlocks = store.Present(values)
	}
	if values := copyValues(parsed.values["removeBlockedBy"]); values != nil {
		input.RemoveBlockedBy = store.Present(values)
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	// 出どころは CLI を動かした場所。opened.Root は worktree の中でも元のフォルダを指す (src/index.ts:486-487)
	directory, err := runner.services.workingDirectory()
	if err != nil {
		return err
	}
	origin, err := runner.services.readProvenance(directory, runner.environment)
	if err != nil {
		return err
	}
	provenance := store.Provenance{Session: origin.Session, Worktree: origin.Worktree, Branch: origin.Branch}
	saved, err := runner.services.saveIssue(opened, input, store.SaveOptions{Provenance: &provenance})
	if err != nil {
		return err
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireIssue(saved))
	}
	if _, err := fmt.Fprintf(runner.stdout, "%s\n", saved.ID); err != nil {
		return err
	}
	return runner.hintBoard(opened, saved.ID)
}

func (runner runtime) hintBoard(opened workspace.Workspace, issueID string) error {
	// src/index.ts:738-748。保存に成功したあとの URL は無くても失敗にしない
	if err := runner.services.register(opened); err != nil {
		return err
	}
	slug, err := runner.services.findSlug(opened.Root)
	if err != nil {
		return err
	}
	base := fmt.Sprintf("http://127.0.0.1:%d/p/%s", server.DefaultPort, api.EncodeURIComponent(slug))
	reachable, err := runner.services.fetchIssue(base + "/api/issues/" + api.EncodeURIComponent(issueID))
	if err != nil || !reachable {
		return nil
	}
	_, err = fmt.Fprintf(runner.stdout, "%s/?id=%s\n", base, api.EncodeURIComponent(issueID))
	return err
}

var commentListFlags = flagSet("help", "h", "issue", "format", "f")
var commentGetFlags = flagSet("help", "h", "id", "format", "f")
var commentSaveFlags = flagSet("help", "h", "id", "issue", "parent", "body", "format", "f")

func (runner runtime) runComment(parsed parsedArguments, rest []string) error {
	subcommand := ""
	if len(rest) > 0 {
		subcommand = rest[0]
	}
	switch subcommand {
	case "list":
		return runner.commentList(parsed, rest)
	case "get":
		return runner.commentGet(parsed, rest)
	case "save":
		return runner.commentSave(parsed, rest)
	default:
		return &commandFailure{message: "usage: yaru comment list|get|save", code: 1}
	}
}

func (runner runtime) commentList(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, commentListFlags); err != nil {
		return err
	}
	if err := rejectExtra(rest[1:]); err != nil {
		return err
	}
	issueID, present := parsed.flag("issue")
	if !present || issueID == "" {
		return &commandFailure{message: "usage: yaru comment list --issue ID", code: 1}
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	comments, err := runner.services.listComments(opened, issueID)
	if err != nil {
		return err
	}
	if comments == nil {
		comments = []store.Comment{}
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireComments(comments))
	}
	_, err = io.WriteString(runner.stdout, formatCommentList(comments))
	return err
}

func (runner runtime) commentGet(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, commentGetFlags); err != nil {
		return err
	}
	commentID, extra := positionalIdentifier(parsed, rest)
	if commentID == "" {
		return &commandFailure{message: "usage: yaru comment get <id>", code: 1}
	}
	if err := rejectExtra(extra); err != nil {
		return err
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	found, err := runner.services.getComment(opened, commentID)
	if err != nil {
		return err
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireComment(found))
	}
	_, err = io.WriteString(runner.stdout, formatComment(found))
	return err
}

func (runner runtime) commentSave(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, commentSaveFlags); err != nil {
		return err
	}
	if err := rejectExtra(rest[1:]); err != nil {
		return err
	}
	// 標準入力はワークスペースを開く前に読む。src/index.ts:537
	body, err := readBody(parsed, runner.stdin)
	if err != nil {
		return err
	}
	input := store.SaveCommentInput{Body: body}
	if value, present := definedString(parsed, "id"); present {
		input.ID = value
	}
	if value, present := definedString(parsed, "issue"); present {
		input.Issue = value
	}
	if value, present := definedString(parsed, "parent"); present {
		input.Parent = value
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	saved, err := runner.services.saveComment(opened, input)
	if err != nil {
		return err
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireComment(saved))
	}
	_, err = fmt.Fprintf(runner.stdout, "%s\n", saved.ID)
	return err
}

var questionListFlags = flagSet("help", "h", "status", "issue", "format", "f")
var questionGetFlags = flagSet("help", "h", "id", "format", "f")
var questionSaveFlags = flagSet("help", "h", "id", "title", "issue", "priority", "default", "answerBy", "option", "body", "status", "force", "format", "f")
var questionAnswerFlags = flagSet("help", "h", "id", "body", "force", "format", "f")
var questionWaitFlags = flagSet("help", "h", "id", "timeout", "interval", "format", "f")

func (runner runtime) runQuestion(parsed parsedArguments, rest []string) error {
	subcommand := ""
	if len(rest) > 0 {
		subcommand = rest[0]
	}
	switch subcommand {
	case "list":
		return runner.questionList(parsed, rest)
	case "get":
		return runner.questionGet(parsed, rest)
	case "save":
		return runner.questionSave(parsed, rest)
	case "answer":
		return runner.questionAnswer(parsed, rest)
	case "wait":
		return runner.questionWait(parsed, rest)
	default:
		return &commandFailure{message: "usage: yaru question list|get|save|answer|wait", code: 1}
	}
}

func (runner runtime) questionList(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, questionListFlags); err != nil {
		return err
	}
	if err := rejectExtra(rest[1:]); err != nil {
		return err
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	filter := questions.QuestionFilter{}
	if value, present := definedString(parsed, "status"); present {
		filter.Status = value
	}
	if value, present := definedString(parsed, "issue"); present {
		filter.Issue = *value
	}
	found, err := runner.services.listQuestions(opened, filter)
	if err != nil {
		return err
	}
	if found == nil {
		found = []questions.Question{}
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireQuestions(found))
	}
	_, err = io.WriteString(runner.stdout, formatQuestionList(found))
	return err
}

func (runner runtime) questionGet(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, questionGetFlags); err != nil {
		return err
	}
	questionID, extra := positionalIdentifier(parsed, rest)
	if questionID == "" {
		return &commandFailure{message: "usage: yaru question get <id>", code: 1}
	}
	if err := rejectExtra(extra); err != nil {
		return err
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	found, err := runner.services.acknowledgeQuestion(opened, questionID)
	if err != nil {
		return err
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireQuestion(found))
	}
	_, err = io.WriteString(runner.stdout, formatQuestion(found))
	return err
}

func (runner runtime) questionSave(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, questionSaveFlags); err != nil {
		return err
	}
	if err := rejectExtra(rest[1:]); err != nil {
		return err
	}
	// ワークスペースを開いてから標準入力を読む。src/index.ts:596-608
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	identifier, identifierPresent := parsed.flag("id")
	creating := !identifierPresent || identifier == ""
	input := questions.SaveInput{}
	if identifierPresent {
		input.ID = stringPointer(identifier)
	}
	if value, present := definedString(parsed, "title"); present {
		input.Title = value
	}
	if value, present := definedString(parsed, "issue"); present {
		input.Issue = value
	}
	if value, present := definedString(parsed, "priority"); present {
		input.Priority = value
	}
	if value, present := definedString(parsed, "default"); present {
		input.DefaultAction = value
	}
	if value, present := definedString(parsed, "answerBy"); present {
		input.AnswerBy = value
	}
	if value, present := definedString(parsed, "status"); present {
		input.Status = value
	}
	if values, present := parsed.values["option"]; present {
		options := []string{}
		if len(values) != 1 || values[0] != "none" {
			options = append([]string(nil), values...)
		}
		input.Options = &options
	}
	body, err := readBody(parsed, runner.stdin)
	if err != nil {
		return err
	}
	input.Body = body
	if creating {
		directory, err := runner.services.workingDirectory()
		if err != nil {
			return err
		}
		origin, err := runner.services.readProvenance(directory, runner.environment)
		if err != nil {
			return err
		}
		provenance := questions.Provenance{Session: origin.Session, Worktree: origin.Worktree, Branch: origin.Branch}
		input.Provenance = &provenance
	}
	if value, present := parsed.flag("force"); present && value == "true" {
		input.Force = true
	}
	saved, err := runner.services.saveQuestion(opened, input)
	if err != nil {
		return err
	}
	if creating {
		if err := runner.warnAndNotify(opened, saved); err != nil {
			return err
		}
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireQuestion(saved))
	}
	_, err = fmt.Fprintf(runner.stdout, "%s\n", saved.ID)
	return err
}

func (runner runtime) warnAndNotify(opened workspace.Workspace, saved questions.Question) error {
	if saved.DefaultAction == nil && saved.AnswerBy == nil {
		if _, err := fmt.Fprintf(runner.stderr, "warning: question %s has no --default and no --answerBy: work blocks until the human answers; give both unless there is no safe default\n", saved.ID); err != nil {
			return err
		}
	}
	if err := runner.services.register(opened); err != nil {
		return err
	}
	slug, err := runner.services.findSlug(opened.Root)
	if err != nil {
		return err
	}
	fallback := fmt.Sprintf("http://127.0.0.1:%d", server.DefaultPort)
	base, err := runner.services.baseURL(opened, fallback)
	if err != nil {
		return err
	}
	warning, err := runner.services.notifyQuestionCreated(opened, runner.services.questionURL(base, slug, saved.ID), saved)
	if err != nil {
		return err
	}
	if warning == "" {
		return nil
	}
	_, err = fmt.Fprintf(runner.stderr, "%s\n", warning)
	return err
}

func (runner runtime) questionAnswer(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, questionAnswerFlags); err != nil {
		return err
	}
	questionID, extra := positionalIdentifier(parsed, rest)
	if questionID == "" {
		return &commandFailure{message: "usage: yaru question answer <id> --body TEXT|-", code: 1}
	}
	if err := rejectExtra(extra); err != nil {
		return err
	}
	body, err := readBody(parsed, runner.stdin)
	if err != nil {
		return err
	}
	input := questions.AnswerInput{Body: body}
	if value, present := parsed.flag("force"); present && value == "true" {
		input.Force = true
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	saved, err := runner.services.answerQuestion(opened, questionID, input)
	if err != nil {
		return err
	}
	if !humanRequested(parsed) {
		return printJSON(runner.stdout, wireQuestion(saved))
	}
	_, err = fmt.Fprintf(runner.stdout, "%s\n", saved.ID)
	return err
}

func (runner runtime) questionWait(parsed parsedArguments, rest []string) error {
	if err := rejectUnknownFlag(parsed, questionWaitFlags); err != nil {
		return err
	}
	questionID, extra := positionalIdentifier(parsed, rest)
	if questionID == "" {
		return &commandFailure{message: "usage: yaru question wait <id>", code: 1}
	}
	if err := rejectExtra(extra); err != nil {
		return err
	}
	timeoutText := "10m"
	if value, present := parsed.flag("timeout"); present {
		timeoutText = value
	}
	intervalText := "1s"
	if value, present := parsed.flag("interval"); present {
		intervalText = value
	}
	timeoutMilliseconds, err := parseDuration("timeout", timeoutText)
	if err != nil {
		return err
	}
	intervalMilliseconds, err := parseDuration("interval", intervalText)
	if err != nil {
		return err
	}
	opened, err := runner.services.openWorkspace()
	if err != nil {
		return err
	}
	deadline := runner.services.monotonic().Add(time.Duration(timeoutMilliseconds) * time.Millisecond)
	current, err := runner.services.getQuestion(opened, questionID)
	if err != nil {
		return err
	}
	for current.Status == "open" && runner.services.monotonic().Before(deadline) {
		remaining := deadline.Sub(runner.services.monotonic())
		pause := time.Duration(intervalMilliseconds) * time.Millisecond
		if remaining < pause {
			pause = remaining
		}
		if pause < 0 {
			pause = 0
		}
		runner.services.sleep(pause)
		current, err = runner.services.getQuestion(opened, questionID)
		if err != nil {
			return err
		}
	}
	current, err = runner.services.acknowledgeQuestion(opened, questionID)
	if err != nil {
		return err
	}
	if humanRequested(parsed) {
		if _, err := io.WriteString(runner.stdout, formatWaitResult(current)); err != nil {
			return err
		}
	} else if err := printJSON(runner.stdout, wireQuestion(current)); err != nil {
		return err
	}
	if current.Status == "open" {
		return &commandFailure{message: fmt.Sprintf("timed out after %s waiting for question %s", timeoutText, questionID), code: 2}
	}
	return nil
}

func stringPointer(value string) *string {
	return &value
}

func copyValues(values []string) []string {
	if values == nil {
		return nil
	}
	return append([]string(nil), values...)
}

func readBody(parsed parsedArguments, stdin io.Reader) (*string, error) {
	value, present := parsed.flag("body")
	if !present {
		return nil, nil
	}
	if value != "-" {
		return stringPointer(value), nil
	}
	text, err := readStandardInput(stdin)
	if err != nil {
		return nil, err
	}
	return stringPointer(text), nil
}

func readPatch(parsed parsedArguments, stdin io.Reader) (any, bool, error) {
	value, present := parsed.flag("patch")
	if !present {
		return nil, false, nil
	}
	text := value
	if value == "-" {
		var err error
		text, err = readStandardInput(stdin)
		if err != nil {
			return nil, true, err
		}
	}
	var parsedJSON any
	if err := json.Unmarshal([]byte(text), &parsedJSON); err != nil {
		quoted, marshalErr := document.MarshalJavaScript(text)
		if marshalErr != nil {
			return nil, true, marshalErr
		}
		return nil, true, &commandFailure{message: "invalid patch: expected a JSON array of operations, actual " + string(quoted), code: 1}
	}
	return parsedJSON, true, nil
}

func readStandardInput(stdin io.Reader) (string, error) {
	if stdin == nil {
		return "", nil
	}
	body, err := io.ReadAll(stdin)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
