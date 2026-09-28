// Claude Code のセッションログを読み、費用とツールの失敗を数える
// 本文は数えない。TS 版の src/sessions.ts。yaru はここへ書かない (docs/spec/yaru-format.md の「.yaru に書かないもの」)
// https://platform.claude.com/docs/en/about-claude/pricing
package sessions

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/aovoq/yaru/internal/clock"
)

const (
	// SessionWindowDays は dashboard が読む日数 (src/sessions.ts:51)
	SessionWindowDays = 7
	// 5 分の cache write は input の 1.25 倍、1 時間は 2 倍、fast mode は全体の 2 倍 (src/sessions.ts:71-74)
	cacheWrite5mMultiplier = 1.25
	cacheWrite1hMultiplier = 2
	fastModeMultiplier     = 2
	million                = 1_000_000
	syntheticModel         = "<synthetic>"
	interruptionPrefix     = "[Request interrupted by user"
)

// TokenCount はトークン数。usage の値が文字列のとき TS の + は連結になる (src/sessions.ts:305-310, src/sessions.ts:359-360)
type TokenCount struct {
	Number  float64
	Text    string
	Textual bool
}

// Summary は 1 セッションの数 (src/sessions.ts:10-30)
type Summary struct {
	ID                  string
	Worktree            *string
	Title               *string
	StartedAt           *string
	LastActivityAt      *string
	Models              []string
	AssistantMessages   int
	InputTokens         TokenCount
	CacheCreationTokens TokenCount
	CacheReadTokens     TokenCount
	OutputTokens        TokenCount
	CostUsd             float64
	UnpricedMessages    int
	ToolUses            int
	ToolResults         int
	ToolErrors          int
	Interruptions       int
	Subagents           int
}

// Totals は窓の中の合計 (src/sessions.ts:32-42)
type Totals struct {
	Sessions          int
	CostUsd           float64
	UnpricedMessages  int
	AssistantMessages int
	CacheReadRatio    *float64
	ToolResults       int
	ToolErrors        int
	ToolErrorRatio    *float64
	Interruptions     int
}

// Health はログの場所と、窓の中のセッション (src/sessions.ts:44-49)
type Health struct {
	Directory  *string
	WindowDays int
	Sessions   []Summary
	Totals     Totals
}

// HealthOptions のゼロ値は、home がユーザーのホーム、now が clock.Now、窓が 7 日 (src/sessions.ts:92-97)
type HealthOptions struct {
	Home       *string
	Now        *time.Time
	WindowDays *int
}

// FindOptions の Worktree は、消したあとの作業ツリーも探すためのパス (src/sessions.ts:136)
type FindOptions struct {
	Home     *string
	Worktree *string
}

type modelPrice struct {
	input     float64
	output    float64
	cacheRead float64
}

// API 換算の単価 (USD / 100 万トークン)。src/sessions.ts:58-69
var modelPrices = map[string]modelPrice{
	"claude-fable-5-1":  {input: 10, output: 50, cacheRead: 0.25},
	"claude-fable-5":    {input: 10, output: 50, cacheRead: 1},
	"claude-opus-5-5":   {input: 4, output: 20, cacheRead: 0.2},
	"claude-opus-5":     {input: 5, output: 25, cacheRead: 0.5},
	"claude-opus-4-8":   {input: 5, output: 25, cacheRead: 0.5},
	"claude-opus-4-7":   {input: 5, output: 25, cacheRead: 0.5},
	"claude-opus-4-6":   {input: 5, output: 25, cacheRead: 0.5},
	"claude-sonnet-5":   {input: 2, output: 10, cacheRead: 0.2},
	"claude-sonnet-4-6": {input: 3, output: 15, cacheRead: 0.3},
	"claude-haiku-4-5":  {input: 1, output: 5, cacheRead: 0.1},
}

var (
	sessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	snapshotSuffix   = regexp.MustCompile(`-\d{8}$`)
	fileCache        = map[string]cachedFile{}
	fileCacheMutex   sync.Mutex
)

type cachedFile struct {
	modifiedMilliseconds float64
	size                 int64
	stats                fileStats
}

type fileStats struct {
	title               *string
	startedAt           *string
	lastActivityAt      *string
	models              map[string]struct{}
	assistantMessages   int
	inputTokens         jsValue
	cacheCreationTokens jsValue
	cacheReadTokens     jsValue
	outputTokens        jsValue
	costUsd             float64
	unpricedMessages    int
	toolUses            int
	toolResults         int
	toolErrors          int
	interruptions       int
}

type sessionSource struct {
	directory string
	worktree  *string
}

type worktreeEntry struct {
	path  string
	label string
}

// ClaudeProjectDirectory は作業ディレクトリの / と . を - にしたログの場所 (src/sessions.ts:88-90)
func ClaudeProjectDirectory(root string, home string) string {
	encoded := strings.NewReplacer("/", "-", ".", "-").Replace(root)
	return filepath.Join(home, ".claude", "projects", encoded)
}

// ReadSessionHealth は窓の中に更新されたセッションを、最後に動いた文字列の新しい順で返す (src/sessions.ts:92-127)
func ReadSessionHealth(root string, options HealthOptions) (Health, error) {
	moment, err := resolveNow(options.Now)
	if err != nil {
		return Health{}, err
	}
	home, err := resolveHome(options.Home)
	if err != nil {
		return Health{}, err
	}
	windowDays := SessionWindowDays
	if options.WindowDays != nil {
		windowDays = *options.WindowDays
	}
	since := float64(moment.UnixMilli()) - float64(windowDays)*86_400_000
	directory := ClaudeProjectDirectory(root, home)
	sources, err := sessionSources(root, home, nil)
	if err != nil {
		return Health{}, err
	}
	sessions := []Summary{}
	for _, source := range sources {
		names, exists, listErr := jsonlNames(source.directory)
		if listErr != nil {
			return Health{}, listErr
		}
		if !exists {
			continue
		}
		for _, name := range names {
			path := filepath.Join(source.directory, name)
			info, statErr := os.Stat(path)
			if statErr != nil {
				return Health{}, nodeIOError(statErr, "stat", path)
			}
			// 更新時刻が窓より前のファイルは読まない (src/sessions.ts:116)
			if mtimeMilliseconds(info.ModTime()) < since {
				continue
			}
			session, readErr := readSession(source.directory, strings.TrimSuffix(name, ".jsonl"), source.worktree)
			if readErr != nil {
				return Health{}, readErr
			}
			sessions = append(sessions, session)
		}
	}
	sort.SliceStable(sessions, func(left, right int) bool {
		return activityText(sessions[left]) > activityText(sessions[right])
	})
	var directoryValue *string
	if pathExists(directory) || len(sessions) > 0 {
		directoryValue = &directory
	}
	return Health{
		Directory:  directoryValue,
		WindowDays: windowDays,
		Sessions:   sessions,
		Totals:     summarize(sessions),
	}, nil
}

// FindSession は期間で絞らず、ファイル名が安全な ID のセッションを返す (src/sessions.ts:133-161)
func FindSession(root string, id string, options FindOptions) (*Summary, error) {
	if !sessionIDPattern.MatchString(id) {
		return nil, nil
	}
	home, err := resolveHome(options.Home)
	if err != nil {
		return nil, err
	}
	sources, err := sessionSources(root, home, options.Worktree)
	if err != nil {
		return nil, err
	}
	for _, source := range sources {
		path := filepath.Join(source.directory, id+".jsonl")
		if _, statErr := os.Stat(path); statErr != nil {
			if os.IsNotExist(statErr) {
				continue
			}
			return nil, nodeIOError(statErr, "stat", path)
		}
		session, readErr := readSession(source.directory, id, source.worktree)
		if readErr != nil {
			return nil, readErr
		}
		return &session, nil
	}
	return nil, nil
}

func sessionSources(root string, home string, recorded *string) ([]sessionSource, error) {
	worktrees, err := linkedWorktrees(root)
	if err != nil {
		return nil, err
	}
	sources := []sessionSource{{directory: ClaudeProjectDirectory(root, home)}}
	for _, entry := range worktrees {
		label := entry.label
		sources = append(sources, sessionSource{
			directory: ClaudeProjectDirectory(entry.path, home),
			worktree:  &label,
		})
	}
	if recorded != nil && *recorded != "" && *recorded != root {
		label := filepath.Base(*recorded)
		for _, entry := range worktrees {
			if entry.path == *recorded {
				label = entry.label
				break
			}
		}
		sources = append(sources, sessionSource{
			directory: ClaudeProjectDirectory(*recorded, home),
			worktree:  &label,
		})
	}
	return sources, nil
}

func resolveNow(now *time.Time) (time.Time, error) {
	if now != nil {
		return *now, nil
	}
	// options.now ?? currentTime() (src/sessions.ts:96)
	return clock.Now()
}

func resolveHome(home *string) (string, error) {
	if home != nil {
		return *home, nil
	}
	// homedir() (src/sessions.ts:88)
	return os.UserHomeDir()
}

func readSession(directory string, id string, worktree *string) (Summary, error) {
	path := filepath.Join(directory, id+".jsonl")
	info, err := os.Stat(path)
	if err != nil {
		return Summary{}, nodeIOError(err, "stat", path)
	}
	main, err := readFileStats(path, info)
	if err != nil {
		return Summary{}, err
	}
	subagentPaths, err := listJSONL(filepath.Join(directory, id, "subagents"))
	if err != nil {
		return Summary{}, err
	}
	subagents := make([]fileStats, 0, len(subagentPaths))
	for _, subagentPath := range subagentPaths {
		subagentInfo, statErr := os.Stat(subagentPath)
		if statErr != nil {
			return Summary{}, nodeIOError(statErr, "stat", subagentPath)
		}
		subagentStats, readErr := readFileStats(subagentPath, subagentInfo)
		if readErr != nil {
			return Summary{}, readErr
		}
		subagents = append(subagents, subagentStats)
	}
	return combine(id, worktree, main, subagents), nil
}

// linkedWorktrees は git worktree list の 2 つ目以降。先頭は元のフォルダなので数に入れない (src/sessions.ts:181-201)
// https://git-scm.com/docs/git-worktree#_porcelain_format
func linkedWorktrees(root string) ([]worktreeEntry, error) {
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, nil
	}
	output, err := gitOutput(root, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	if !output.ok {
		return nil, nil
	}
	blocks := strings.Split(output.text, "\n\n")
	entries := []worktreeEntry{}
	for _, block := range blocks {
		var path string
		var branch string
		havePath := false
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "worktree ") {
				path = strings.TrimPrefix(line, "worktree ")
				havePath = true
			}
			if strings.HasPrefix(line, "branch ") {
				branch = strings.TrimPrefix(line, "branch ")
			}
		}
		if !havePath {
			continue
		}
		label := filepath.Base(path)
		if branch != "" {
			label = strings.TrimPrefix(branch, "refs/heads/")
		}
		entries = append(entries, worktreeEntry{path: path, label: label})
	}
	if len(entries) <= 1 {
		return nil, nil
	}
	return entries[1:], nil
}

func listJSONL(directory string) ([]string, error) {
	info, err := os.Stat(directory)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, nodeIOError(err, "scandir", directory)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("ENOTDIR: not a directory, scandir '%s'", directory)
	}
	entries, err := readDirectory(directory)
	if err != nil {
		return nil, nodeIOError(err, "scandir", directory)
	}
	files := []string{}
	for _, entry := range entries {
		path := filepath.Join(directory, entry.Name())
		if entry.IsDir() {
			nested, nestErr := listJSONL(path)
			if nestErr != nil {
				return nil, nestErr
			}
			files = append(files, nested...)
			continue
		}
		if strings.HasSuffix(entry.Name(), ".jsonl") {
			files = append(files, path)
		}
	}
	return files, nil
}

func jsonlNames(directory string) ([]string, bool, error) {
	info, err := os.Stat(directory)
	if err != nil {
		return nil, false, nil
	}
	if !info.IsDir() {
		return nil, true, fmt.Errorf("ENOTDIR: not a directory, scandir '%s'", directory)
	}
	entries, err := readDirectory(directory)
	if err != nil {
		return nil, true, nodeIOError(err, "scandir", directory)
	}
	names := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".jsonl") {
			names = append(names, entry.Name())
		}
	}
	return names, true, nil
}

func readDirectory(directory string) ([]os.DirEntry, error) {
	file, err := os.Open(directory)
	if err != nil {
		return nil, err
	}
	entries, readErr := file.ReadDir(-1)
	closeErr := file.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return entries, nil
}

func readFileStats(path string, info os.FileInfo) (fileStats, error) {
	if info.IsDir() {
		// readFileSync がディレクトリを読むときの Bun の文言。パスは付かない (src/sessions.ts:219)
		return fileStats{}, errors.New("EISDIR: illegal operation on a directory, read")
	}
	modified := mtimeMilliseconds(info.ModTime())
	size := info.Size()
	fileCacheMutex.Lock()
	cached, ok := fileCache[path]
	fileCacheMutex.Unlock()
	if ok && cached.modifiedMilliseconds == modified && cached.size == size {
		return cached.stats, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fileStats{}, nodeIOError(err, "open", path)
	}
	text := string(data)
	if !utf8.ValidString(text) {
		text = strings.ToValidUTF8(text, "\uFFFD")
	}
	stats, err := parseFile(text)
	if err != nil {
		return fileStats{}, err
	}
	fileCacheMutex.Lock()
	fileCache[path] = cachedFile{modifiedMilliseconds: modified, size: size, stats: stats}
	fileCacheMutex.Unlock()
	return stats, nil
}

func parseFile(text string) (fileStats, error) {
	stats := fileStats{models: map[string]struct{}{}}
	seenMessages := map[string]struct{}{}
	for _, line := range strings.Split(text, "\n") {
		if line == "" {
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			// 書き込み途中の行は飛ばして、残りの行を数える (src/sessions.ts:248-250)
			continue
		}
		if entry["type"] == "ai-title" {
			if title, ok := entry["aiTitle"].(string); ok {
				stats.title = &title
			}
		}
		if timestamp, ok := entry["timestamp"].(string); ok {
			if stats.startedAt == nil {
				value := timestamp
				stats.startedAt = &value
			}
			if stats.lastActivityAt == nil || timestamp > *stats.lastActivityAt {
				value := timestamp
				stats.lastActivityAt = &value
			}
		}
		message, _ := entry["message"].(map[string]any)
		content := contentBlocks(message)
		switch entry["type"] {
		case "assistant":
			if err := countAssistant(&stats, message, content, seenMessages); err != nil {
				return fileStats{}, err
			}
		case "user":
			if err := countUser(&stats, content); err != nil {
				return fileStats{}, err
			}
		}
	}
	return stats, nil
}

func contentBlocks(message map[string]any) []any {
	if message == nil {
		return nil
	}
	content, ok := message["content"].([]any)
	if !ok {
		return nil
	}
	return content
}

func countAssistant(stats *fileStats, message map[string]any, content []any, seenMessages map[string]struct{}) error {
	for _, block := range content {
		fields, err := blockFields(block)
		if err != nil {
			return err
		}
		if fields["type"] == "tool_use" {
			stats.toolUses++
		}
	}
	if message == nil || !isTruthy(message["usage"]) || isExactString(message["model"], syntheticModel) {
		return nil
	}
	if isTruthy(message["id"]) {
		key := identityKey(message["id"])
		if _, seen := seenMessages[key]; seen {
			return nil
		}
		seenMessages[key] = struct{}{}
	}
	usage, usageIsObject := message["usage"].(map[string]any)
	if !usageIsObject {
		usage = map[string]any{}
	}
	input := coalesced(usage, "input_tokens")
	output := coalesced(usage, "output_tokens")
	cacheRead := coalesced(usage, "cache_read_input_tokens")
	cacheCreation := coalesced(usage, "cache_creation_input_tokens")
	stats.assistantMessages++
	stats.inputTokens = jsAdd(stats.inputTokens, input)
	stats.outputTokens = jsAdd(stats.outputTokens, output)
	stats.cacheReadTokens = jsAdd(stats.cacheReadTokens, cacheRead)
	stats.cacheCreationTokens = jsAdd(stats.cacheCreationTokens, cacheCreation)
	modelText, modelIsString := message["model"].(string)
	if modelIsString && modelText != "" {
		stats.models[modelText] = struct{}{}
	}
	price, priced := modelPrice{}, false
	if modelIsString && modelText != "" {
		price, priced = priceOf(modelText)
	}
	if !priced {
		stats.unpricedMessages++
		return nil
	}
	creation, _ := usage["cache_creation"].(map[string]any)
	cacheWrite1h := jsValue{}
	if present(creation, "ephemeral_1h_input_tokens") {
		cacheWrite1h = jsFrom(creation["ephemeral_1h_input_tokens"])
	}
	var cacheWrite5m jsValue
	if present(creation, "ephemeral_5m_input_tokens") {
		cacheWrite5m = jsFrom(creation["ephemeral_5m_input_tokens"])
	} else {
		cacheWrite5m = jsValue{number: cacheCreation.numberValue() - cacheWrite1h.numberValue()}
	}
	cost := (input.numberValue()*price.input +
		output.numberValue()*price.output +
		cacheRead.numberValue()*price.cacheRead +
		cacheWrite5m.numberValue()*price.input*cacheWrite5mMultiplier +
		cacheWrite1h.numberValue()*price.input*cacheWrite1hMultiplier) / million
	if isExactString(usage["speed"], "fast") {
		cost *= fastModeMultiplier
	}
	stats.costUsd += cost
	return nil
}

func priceOf(model string) (modelPrice, bool) {
	if price, ok := modelPrices[model]; ok {
		return price, true
	}
	price, ok := modelPrices[snapshotSuffix.ReplaceAllString(model, "")]
	return price, ok
}

func countUser(stats *fileStats, content []any) error {
	for _, block := range content {
		fields, err := blockFields(block)
		if err != nil {
			return err
		}
		if fields["type"] == "tool_result" {
			stats.toolResults++
			if errorFlag, ok := fields["is_error"].(bool); ok && errorFlag {
				stats.toolErrors++
			}
		}
		if fields["type"] != "text" {
			continue
		}
		text, exists := fields["text"]
		if !exists || text == nil {
			continue
		}
		stringText, ok := text.(string)
		if !ok {
			return errors.New("TypeError: block.text?.startsWith is not a function. (In 'block.text?.startsWith(INTERRUPTION_PREFIX)', 'block.text?.startsWith' is undefined)")
		}
		if strings.HasPrefix(stringText, interruptionPrefix) {
			stats.interruptions++
		}
	}
	return nil
}

func blockFields(block any) (map[string]any, error) {
	if block == nil {
		return nil, errors.New("TypeError: null is not an object (evaluating 'block.type')")
	}
	fields, ok := block.(map[string]any)
	if !ok {
		return map[string]any{}, nil
	}
	return fields, nil
}

func combine(id string, worktree *string, main fileStats, subagents []fileStats) Summary {
	all := append([]fileStats{main}, subagents...)
	models := map[string]struct{}{}
	timestamps := []string{}
	input := jsValue{}
	cacheCreation := jsValue{}
	cacheRead := jsValue{}
	output := jsValue{}
	var cost float64
	var assistants, unpriced, toolUses, toolResults, toolErrors int
	for _, stats := range all {
		for model := range stats.models {
			models[model] = struct{}{}
		}
		if stats.startedAt != nil {
			timestamps = append(timestamps, *stats.startedAt)
		}
		if stats.lastActivityAt != nil {
			timestamps = append(timestamps, *stats.lastActivityAt)
		}
		input = jsAdd(input, stats.inputTokens)
		cacheCreation = jsAdd(cacheCreation, stats.cacheCreationTokens)
		cacheRead = jsAdd(cacheRead, stats.cacheReadTokens)
		output = jsAdd(output, stats.outputTokens)
		cost += stats.costUsd
		assistants += stats.assistantMessages
		unpriced += stats.unpricedMessages
		toolUses += stats.toolUses
		toolResults += stats.toolResults
		toolErrors += stats.toolErrors
	}
	sort.Strings(timestamps)
	names := make([]string, 0, len(models))
	for model := range models {
		names = append(names, model)
	}
	sort.Strings(names)
	summary := Summary{
		ID:                  id,
		Worktree:            worktree,
		Title:               main.title,
		Models:              names,
		AssistantMessages:   assistants,
		InputTokens:         input.tokenCount(),
		CacheCreationTokens: cacheCreation.tokenCount(),
		CacheReadTokens:     cacheRead.tokenCount(),
		OutputTokens:        output.tokenCount(),
		CostUsd:             cost,
		UnpricedMessages:    unpriced,
		ToolUses:            toolUses,
		ToolResults:         toolResults,
		ToolErrors:          toolErrors,
		// 割り込みはメインのセッションだけ数える (src/sessions.ts:378-379)
		Interruptions: main.interruptions,
		Subagents:     len(subagents),
	}
	if len(timestamps) > 0 {
		started := timestamps[0]
		last := timestamps[len(timestamps)-1]
		summary.StartedAt = &started
		summary.LastActivityAt = &last
	}
	return summary
}

func summarize(sessions []Summary) Totals {
	input := jsValue{}
	cacheCreation := jsValue{}
	cacheRead := jsValue{}
	var cost float64
	var unpriced, assistants, toolResults, toolErrors, interruptions int
	for _, session := range sessions {
		input = jsAdd(input, tokenToJS(session.InputTokens))
		cacheCreation = jsAdd(cacheCreation, tokenToJS(session.CacheCreationTokens))
		cacheRead = jsAdd(cacheRead, tokenToJS(session.CacheReadTokens))
		cost += session.CostUsd
		unpriced += session.UnpricedMessages
		assistants += session.AssistantMessages
		toolResults += session.ToolResults
		toolErrors += session.ToolErrors
		interruptions += session.Interruptions
	}
	prompt := jsAdd(jsAdd(input, cacheCreation), cacheRead)
	totals := Totals{
		Sessions:          len(sessions),
		CostUsd:           cost,
		UnpricedMessages:  unpriced,
		AssistantMessages: assistants,
		ToolResults:       toolResults,
		ToolErrors:        toolErrors,
		Interruptions:     interruptions,
	}
	if prompt.numberValue() > 0 {
		ratio := cacheRead.numberValue() / prompt.numberValue()
		totals.CacheReadRatio = &ratio
	}
	if toolResults > 0 {
		ratio := float64(toolErrors) / float64(toolResults)
		totals.ToolErrorRatio = &ratio
	}
	return totals
}

func activityText(session Summary) string {
	if session.LastActivityAt == nil {
		return ""
	}
	return *session.LastActivityAt
}

type jsKind int

const (
	jsKindNumber jsKind = iota
	jsKindString
)

type jsValue struct {
	kind   jsKind
	number float64
	text   string
}

func (value jsValue) numberValue() float64 {
	if value.kind == jsKindString {
		return parseJSNumber(value.text)
	}
	return value.number
}

func (value jsValue) stringValue() string {
	if value.kind == jsKindString {
		return value.text
	}
	return formatJSNumber(value.number)
}

func (value jsValue) tokenCount() TokenCount {
	if value.kind == jsKindString {
		return TokenCount{Text: value.text, Textual: true}
	}
	return TokenCount{Number: value.number}
}

func tokenToJS(count TokenCount) jsValue {
	if count.Textual {
		return jsValue{kind: jsKindString, text: count.Text}
	}
	return jsValue{number: count.Number}
}

func jsAdd(left jsValue, right jsValue) jsValue {
	if left.kind == jsKindString || right.kind == jsKindString {
		return jsValue{kind: jsKindString, text: left.stringValue() + right.stringValue()}
	}
	return jsValue{number: left.number + right.number}
}

func jsFrom(value any) jsValue {
	switch typed := value.(type) {
	case float64:
		return jsValue{number: typed}
	case string:
		return jsValue{kind: jsKindString, text: typed}
	case bool:
		if typed {
			return jsValue{number: 1}
		}
		return jsValue{}
	default:
		return jsValue{kind: jsKindString, text: "[object Object]"}
	}
}

func coalesced(object map[string]any, key string) jsValue {
	if !present(object, key) {
		return jsValue{}
	}
	return jsFrom(object[key])
}

func present(object map[string]any, key string) bool {
	if object == nil {
		return false
	}
	value, ok := object[key]
	return ok && value != nil
}

func isTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case string:
		return typed != ""
	default:
		return true
	}
}

func isExactString(value any, want string) bool {
	text, ok := value.(string)
	return ok && text == want
}

func identityKey(value any) string {
	switch typed := value.(type) {
	case string:
		return "s:" + typed
	case float64:
		return "n:" + formatJSNumber(typed)
	case bool:
		if typed {
			return "b:true"
		}
		return "b:false"
	default:
		return "o:" + fmt.Sprint(value)
	}
}

func parseJSNumber(text string) float64 {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}
	value, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return math.NaN()
	}
	return value
}

func formatJSNumber(value float64) string {
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
	if value == math.Trunc(value) && math.Abs(value) < 1e21 {
		return strconv.FormatFloat(value, 'f', 0, 64)
	}
	return strconv.FormatFloat(value, 'g', -1, 64)
}

func mtimeMilliseconds(moment time.Time) float64 {
	return float64(moment.UnixNano()) / 1e6
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

type commandOutput struct {
	text string
	ok   bool
}

func gitOutput(root string, args ...string) (commandOutput, error) {
	command := exec.Command("git", args...)
	command.Dir = root
	command.Stderr = io.Discard
	output, err := command.Output()
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			return commandOutput{}, nil
		}
		return commandOutput{}, spawnError(err)
	}
	return commandOutput{text: strings.TrimSpace(string(output)), ok: true}, nil
}

func spawnError(err error) error {
	if errors.Is(err, exec.ErrNotFound) || os.IsNotExist(err) {
		return errors.New("ENOENT: no such file or directory, posix_spawn 'git'")
	}
	if os.IsPermission(err) {
		return errors.New("EACCES: permission denied, posix_spawn 'git'")
	}
	if errors.Is(err, syscall.ENOTDIR) {
		return errors.New("ENOTDIR: not a directory, posix_spawn 'git'")
	}
	return err
}

func nodeIOError(err error, syscallName string, path string) error {
	if os.IsNotExist(err) {
		return fmt.Errorf("ENOENT: no such file or directory, %s '%s'", syscallName, path)
	}
	if os.IsPermission(err) {
		return fmt.Errorf("EACCES: permission denied, %s '%s'", syscallName, path)
	}
	if errors.Is(err, syscall.EISDIR) {
		return errors.New("EISDIR: illegal operation on a directory, read")
	}
	if errors.Is(err, syscall.ENOTDIR) {
		return fmt.Errorf("ENOTDIR: not a directory, scandir '%s'", path)
	}
	return err
}
