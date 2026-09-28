package sessions_test

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/sessions"
)

func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "yaru-sessions-home-")
	if err != nil {
		panic(err)
	}
	_ = os.MkdirAll(filepath.Join(home, "state"), 0o755)
	_ = os.Setenv("HOME", home)
	_ = os.Setenv("YARU_STATE_DIR", filepath.Join(home, "state"))
	_ = os.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	_ = os.Setenv("TZ", "Asia/Tokyo")
	_ = os.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	_ = os.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	_ = os.Setenv("GIT_AUTHOR_NAME", "tester")
	_ = os.Setenv("GIT_AUTHOR_EMAIL", "t@example.com")
	_ = os.Setenv("GIT_COMMITTER_NAME", "tester")
	_ = os.Setenv("GIT_COMMITTER_EMAIL", "t@example.com")
	code := m.Run()
	_ = os.RemoveAll(home)
	os.Exit(code)
}

var now = time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

const root = "/Users/someone/ghq/github.com/org/app"

func homeOf(t *testing.T) string {
	t.Helper()
	return t.TempDir()
}

func options(home string) sessions.HealthOptions {
	return sessions.HealthOptions{Home: home, Now: now}
}

func readHealth(root string, healthOptions sessions.HealthOptions) (sessions.Health, error) {
	return sessions.NewReader().ReadHealth(context.Background(), root, healthOptions)
}

func findSession(root string, id string, findOptions sessions.FindOptions) (*sessions.Summary, error) {
	return sessions.NewReader().Find(context.Background(), root, id, findOptions)
}

func writeSession(t *testing.T, directory string, name string, lines []any, modified time.Time) string {
	t.Helper()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	var builder strings.Builder
	for _, line := range lines {
		encoded, err := json.Marshal(line)
		if err != nil {
			t.Fatal(err)
		}
		builder.Write(encoded)
		builder.WriteByte('\n')
	}
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte(builder.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modified, modified); err != nil {
		t.Fatal(err)
	}
	return path
}

func assistant(id string, timestamp string, usage map[string]any, model string, content []any) map[string]any {
	if content == nil {
		content = []any{map[string]any{"type": "text", "text": "x"}}
	}
	return map[string]any{
		"type":      "assistant",
		"timestamp": timestamp,
		"message": map[string]any{
			"id":      id,
			"model":   model,
			"usage":   usage,
			"content": content,
		},
	}
}

func TestClaudeProjectDirectory(t *testing.T) {
	if got := sessions.ClaudeProjectDirectory(root, "/home/me"); got != "/home/me/.claude/projects/-Users-someone-ghq-github-com-org-app" {
		t.Fatal(got)
	}
	if got := sessions.ClaudeProjectDirectory("", "/home/me"); got != "/home/me/.claude/projects" {
		t.Fatal(got)
	}
	if got := sessions.ClaudeProjectDirectory("/tmp/a.b/../c", "/home/me"); got != "/home/me/.claude/projects/-tmp-a-b----c" {
		t.Fatal(got)
	}
	if got := sessions.ClaudeProjectDirectory("/tmp/やる.事", "/home/me/"); got != "/home/me/.claude/projects/-tmp-やる-事" {
		t.Fatal(got)
	}
}

func TestReadSessionHealthWithoutLogs(t *testing.T) {
	health, err := readHealth(root, options(homeOf(t)))
	if err != nil {
		t.Fatal(err)
	}
	if health.Directory != nil || len(health.Sessions) != 0 || health.WindowDays != 7 || health.Totals.CostUsd != 0 || health.Totals.CacheReadRatio != nil || health.Totals.ToolErrorRatio != nil {
		t.Fatalf("%#v", health)
	}
}

func TestReadSessionHealthPricesUsageOnceAndKeepsTitle(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	usage := map[string]any{
		"input_tokens":                1_000_000,
		"output_tokens":               1_000_000,
		"cache_read_input_tokens":     2_000_000,
		"cache_creation_input_tokens": 1_000_000,
		"cache_creation": map[string]any{
			"ephemeral_5m_input_tokens": 0,
			"ephemeral_1h_input_tokens": 1_000_000,
		},
	}
	writeSession(t, project, "s1.jsonl", []any{
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:00.000Z", "message": map[string]any{"content": "hello"}},
		assistant("m1", "2026-09-25T10:00:01.000Z", usage, "claude-opus-5-5", nil),
		assistant("m1", "2026-09-25T10:00:02.000Z", usage, "claude-opus-5-5", nil),
		map[string]any{"type": "ai-title", "aiTitle": "first title"},
		map[string]any{"type": "ai-title", "aiTitle": "latest title"},
		map[string]any{"type": "ai-title", "aiTitle": 12},
	}, now)
	health, err := readHealth(root, options(home))
	if err != nil {
		t.Fatal(err)
	}
	if health.Directory == nil || *health.Directory != project || len(health.Sessions) != 1 {
		t.Fatalf("%#v", health.Directory)
	}
	session := health.Sessions[0]
	if session.ID != "s1" || session.Worktree != nil || session.Title == nil || *session.Title != "latest title" {
		t.Fatalf("%#v", session)
	}
	if session.StartedAt == nil || *session.StartedAt != "2026-09-25T10:00:00.000Z" || session.LastActivityAt == nil || *session.LastActivityAt != "2026-09-25T10:00:02.000Z" {
		t.Fatalf("%#v %#v", session.StartedAt, session.LastActivityAt)
	}
	if len(session.Models) != 1 || session.Models[0] != "claude-opus-5-5" || session.AssistantMessages != 1 {
		t.Fatalf("%#v", session)
	}
	if session.InputTokens != (sessions.TokenCount{Number: 1_000_000}) || session.OutputTokens.Number != 1_000_000 || session.CacheReadTokens.Number != 2_000_000 || session.CacheCreationTokens.Number != 1_000_000 {
		t.Fatalf("%#v", session)
	}
	if session.CostUsd != 32.4 || session.UnpricedMessages != 0 || health.Totals.CacheReadRatio == nil || *health.Totals.CacheReadRatio != 0.5 {
		t.Fatalf("cost %v ratio %#v", session.CostUsd, health.Totals.CacheReadRatio)
	}
}

func TestReadSessionHealthToolsSubagentsAndInterruptions(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	small := map[string]any{"input_tokens": 100, "output_tokens": 10}
	writeSession(t, project, "s1.jsonl", []any{
		assistant("m1", "2026-09-25T10:00:00.000Z", small, "claude-opus-5-5", []any{
			map[string]any{"type": "tool_use", "id": "t", "name": "Bash", "input": map[string]any{}},
			map[string]any{"type": "tool_use", "id": "u", "name": "Read", "input": map[string]any{}},
		}),
		assistant("m1", "2026-09-25T10:00:00.500Z", small, "claude-opus-5-5", []any{
			map[string]any{"type": "tool_use", "id": "again", "name": "Bash", "input": map[string]any{}},
		}),
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:01.000Z", "message": map[string]any{"content": []any{map[string]any{"type": "tool_result", "is_error": false}}}},
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:02.000Z", "message": map[string]any{"content": []any{map[string]any{"type": "tool_result", "is_error": true}}}},
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:02.500Z", "message": map[string]any{"content": []any{map[string]any{"type": "tool_result", "is_error": 1}}}},
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:03.000Z", "message": map[string]any{"content": []any{map[string]any{"type": "text", "text": "[Request interrupted by user]"}}}},
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:03.100Z", "message": map[string]any{"content": []any{map[string]any{"type": "text", "text": "[Request interrupted by user for tool use]"}}}},
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:00:03.200Z", "message": map[string]any{"content": []any{map[string]any{"type": "text", "text": " [Request interrupted by user]"}}}},
	}, now)
	writeSession(t, filepath.Join(project, "s1", "subagents", "workflows"), "agent-a.jsonl", []any{
		assistant("m2", "2026-09-25T10:05:00.000Z", small, "claude-sonnet-5", nil),
		map[string]any{"type": "user", "timestamp": "2026-09-25T10:05:01.000Z", "message": map[string]any{"content": []any{
			map[string]any{"type": "tool_result", "is_error": true},
			map[string]any{"type": "text", "text": "[Request interrupted by user]"},
		}}},
		map[string]any{"type": "ai-title", "aiTitle": "sub title"},
	}, now)
	writeSession(t, filepath.Join(project, "s1", "subagents"), "top.jsonl", []any{
		map[string]any{"type": "user", "timestamp": "2026-09-24T00:00:00.000Z", "message": map[string]any{"content": []any{}}},
	}, now)
	health, err := readHealth(root, options(home))
	if err != nil {
		t.Fatal(err)
	}
	session := health.Sessions[0]
	if session.ToolUses != 3 || session.ToolResults != 4 || session.ToolErrors != 2 || session.Interruptions != 2 || session.Subagents != 2 {
		t.Fatalf("%#v", session)
	}
	if session.AssistantMessages != 2 || session.InputTokens.Number != 200 || session.OutputTokens.Number != 20 || session.CostUsd != 0.0009 {
		t.Fatalf("%#v cost %v", session, session.CostUsd)
	}
	if session.Title != nil || session.StartedAt == nil || *session.StartedAt != "2026-09-24T00:00:00.000Z" || session.LastActivityAt == nil || *session.LastActivityAt != "2026-09-25T10:05:01.000Z" {
		t.Fatalf("%#v", session)
	}
	if strings.Join(session.Models, ",") != "claude-opus-5-5,claude-sonnet-5" {
		t.Fatal(session.Models)
	}
	if health.Totals.ToolErrorRatio == nil || *health.Totals.ToolErrorRatio != 0.5 {
		t.Fatalf("%#v", health.Totals.ToolErrorRatio)
	}
}

func TestReadSessionHealthModelsPricesAndStringTokens(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	writeSession(t, project, "s1.jsonl", []any{
		assistant("m1", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 5, "output_tokens": 5}, "claude-future-9", nil),
		assistant("m2", "2026-09-25T10:00:01.000Z", map[string]any{"input_tokens": 5, "output_tokens": 5}, "<synthetic>", nil),
		assistant("m3", "2026-09-25T10:00:02.000Z", map[string]any{"input_tokens": 1_000_000, "output_tokens": 0}, "claude-haiku-4-5-20251001", nil),
		assistant("m4", "2026-09-25T10:00:03.000Z", map[string]any{"input_tokens": 1_000_000, "output_tokens": 0, "speed": "fast"}, "claude-opus-5-5", nil),
		assistant("m5", "2026-09-25T10:00:04.000Z", map[string]any{"input_tokens": 1_000_000, "output_tokens": 0, "speed": "Fast"}, "claude-opus-5-5", nil),
	}, now)
	health, err := readHealth(root, options(home))
	if err != nil {
		t.Fatal(err)
	}
	session := health.Sessions[0]
	if session.UnpricedMessages != 1 || session.CostUsd != 13 || strings.Join(session.Models, ",") != "claude-future-9,claude-haiku-4-5-20251001,claude-opus-5-5" {
		t.Fatalf("%#v cost %v", session, session.CostUsd)
	}

	priceHome := homeOf(t)
	priceProject := sessions.ClaudeProjectDirectory(root, priceHome)
	models := []struct {
		name string
		cost float64
	}{
		{"claude-fable-5-1", 10.25},
		{"claude-fable-5", 11},
		{"claude-opus-5-5", 4.2},
		{"claude-opus-5", 5.5},
		{"claude-opus-4-8", 5.5},
		{"claude-opus-4-7", 5.5},
		{"claude-opus-4-6", 5.5},
		{"claude-opus-4-6-20250101", 5.5},
		{"claude-sonnet-5", 2.2},
		{"claude-sonnet-4-6", 3.3},
		{"claude-haiku-4-5", 1.1},
		{"claude-future-9-20250101", 0},
		{"claude-haiku-4-5-202510011", 0},
		{"claude-haiku-4-5-2025100", 0},
	}
	for index, model := range models {
		stamp := time.Date(2026, 9, 25, 10, index, 0, 0, time.UTC).Format(time.RFC3339Nano)
		writeSession(t, priceProject, model.name+".jsonl", []any{
			assistant("m", stamp, map[string]any{"input_tokens": 1_000_000, "output_tokens": 0, "cache_read_input_tokens": 1_000_000}, model.name, nil),
		}, now)
	}
	priced, err := readHealth(root, options(priceHome))
	if err != nil {
		t.Fatal(err)
	}
	byModel := map[string]sessions.Summary{}
	for _, session := range priced.Sessions {
		if len(session.Models) == 1 {
			byModel[session.Models[0]] = session
		} else {
			byModel["unpriced:"+session.ID] = session
		}
	}
	for _, model := range models {
		session, ok := byModel[model.name]
		if !ok {
			t.Fatalf("missing %s in %#v", model.name, priced.Sessions)
		}
		if session.CostUsd != model.cost {
			t.Fatalf("%s cost %v want %v", model.name, session.CostUsd, model.cost)
		}
		if model.cost == 0 && session.UnpricedMessages != 1 {
			t.Fatalf("%s unpriced %d", model.name, session.UnpricedMessages)
		}
	}

	cacheHome := homeOf(t)
	cacheProject := sessions.ClaudeProjectDirectory(root, cacheHome)
	writeSession(t, cacheProject, "s1.jsonl", []any{assistant("m1", "2026-09-25T10:00:00.000Z", map[string]any{
		"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 1_000_000,
		"cache_creation": map[string]any{"ephemeral_5m_input_tokens": 1_000_000, "ephemeral_1h_input_tokens": 0},
	}, "claude-haiku-4-5", nil)}, now)
	writeSession(t, cacheProject, "s2.jsonl", []any{assistant("m2", "2026-09-25T11:00:00.000Z", map[string]any{
		"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 2_000_000,
	}, "claude-haiku-4-5", nil)}, now)
	writeSession(t, cacheProject, "s3.jsonl", []any{assistant("m3", "2026-09-25T11:30:00.000Z", map[string]any{
		"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 2_000_000,
		"cache_creation": map[string]any{"ephemeral_1h_input_tokens": 500_000},
	}, "claude-haiku-4-5", nil)}, now)
	cached, err := readHealth(root, options(cacheHome))
	if err != nil {
		t.Fatal(err)
	}
	costs := map[string]float64{}
	for _, session := range cached.Sessions {
		costs[session.ID] = session.CostUsd
	}
	if costs["s1"] != 1.25 || costs["s2"] != 2.5 || costs["s3"] != 2.875 {
		t.Fatalf("%v", costs)
	}

	stringHome := homeOf(t)
	stringProject := sessions.ClaudeProjectDirectory(root, stringHome)
	writeSession(t, stringProject, "s.jsonl", []any{
		map[string]any{"type": "assistant", "timestamp": "2026-09-25T10:00:00.000Z", "message": map[string]any{
			"id": "loose", "model": "claude-haiku-4-5", "usage": map[string]any{"input_tokens": "10", "output_tokens": 1}, "content": []any{},
		}},
	}, now)
	textual, err := readHealth(root, options(stringHome))
	if err != nil {
		t.Fatal(err)
	}
	if !textual.Sessions[0].InputTokens.Textual || textual.Sessions[0].InputTokens.Text != "0010" || textual.Sessions[0].CostUsd != 0.000015 {
		t.Fatalf("%#v cost %v", textual.Sessions[0].InputTokens, textual.Sessions[0].CostUsd)
	}
	if textual.Totals.CacheReadRatio == nil || *textual.Totals.CacheReadRatio != 0 {
		t.Fatalf("%#v", textual.Totals.CacheReadRatio)
	}
}

func TestReadSessionHealthWindowOrderBoundaryAndBrokenLines(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	usage := map[string]any{"input_tokens": 1, "output_tokens": 1}
	writeSession(t, project, "old.jsonl", []any{assistant("m0", "2026-09-01T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	writeSession(t, project, "a.jsonl", []any{assistant("m1", "2026-09-24T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, now)
	writeSession(t, project, "b.jsonl", []any{assistant("m2", "2026-09-25T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, now)
	writeSession(t, project, "empty.jsonl", nil, now)
	writeSession(t, project, "notes.txt", []any{assistant("m5", "2026-09-25T12:00:00.000Z", usage, "claude-haiku-4-5", nil)}, now)
	if err := os.MkdirAll(filepath.Join(project, "other"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeSession(t, filepath.Join(project, "other"), "x.jsonl", []any{assistant("m6", "2026-09-25T12:00:00.000Z", usage, "claude-haiku-4-5", nil)}, now)
	window := 7
	health, err := readHealth(root, sessions.HealthOptions{Home: home, Now: now, WindowDays: &window})
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, session := range health.Sessions {
		ids = append(ids, session.ID)
	}
	if strings.Join(ids, ",") != "b,a,empty" || health.WindowDays != 7 {
		t.Fatalf("%v window %d", ids, health.WindowDays)
	}
	if health.Sessions[2].StartedAt != nil || health.Sessions[2].LastActivityAt != nil || health.Sessions[2].AssistantMessages != 0 {
		t.Fatalf("%#v", health.Sessions[2])
	}

	boundaryHome := homeOf(t)
	boundaryProject := sessions.ClaudeProjectDirectory(root, boundaryHome)
	since := now.Add(-7 * 24 * time.Hour)
	writeSession(t, boundaryProject, "exact.jsonl", []any{assistant("m", "2026-09-25T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, since)
	writeSession(t, boundaryProject, "before.jsonl", []any{assistant("m", "2026-09-25T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, since.Add(-time.Millisecond))
	writeSession(t, boundaryProject, "after.jsonl", []any{assistant("m", "2026-09-25T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, since.Add(time.Millisecond))
	boundary, err := readHealth(root, sessions.HealthOptions{Home: boundaryHome, Now: now, WindowDays: &window})
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, session := range boundary.Sessions {
		got = append(got, session.ID)
	}
	if strings.Join(got, ",") != "after,exact" && strings.Join(got, ",") != "exact,after" {
		t.Fatalf("%v", got)
	}
	zero := 0
	zeroHealth, err := readHealth(root, sessions.HealthOptions{Home: boundaryHome, Now: now, WindowDays: &zero})
	if err != nil {
		t.Fatal(err)
	}
	if len(zeroHealth.Sessions) != 0 || zeroHealth.WindowDays != 0 {
		t.Fatalf("%#v", zeroHealth.Sessions)
	}

	brokenHome := homeOf(t)
	brokenProject := sessions.ClaudeProjectDirectory(root, brokenHome)
	if err := os.MkdirAll(brokenProject, 0o755); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(assistant("m1", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 7, "output_tokens": 1}, "claude-opus-5-5", nil))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(brokenProject, "s1.jsonl"), append([]byte("{\"type\":\"assistant\",\n"), append(encoded, '\n')...), 0o644); err != nil {
		t.Fatal(err)
	}
	broken, err := readHealth(root, options(brokenHome))
	if err != nil {
		t.Fatal(err)
	}
	if broken.Sessions[0].InputTokens.Number != 7 || broken.Sessions[0].CostUsd != 0.000048 {
		t.Fatalf("%#v cost %v", broken.Sessions[0].InputTokens, broken.Sessions[0].CostUsd)
	}
}

func TestReadSessionHealthTimestampQuirksAndCache(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	writeSession(t, project, "s1.jsonl", []any{
		assistant("m1", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-haiku-4-5", nil),
		assistant("m2", "2026-09-25T09:00:00.000Z", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-haiku-4-5", nil),
		assistant("m3", "b-not-iso", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-haiku-4-5", nil),
		map[string]any{"type": "assistant", "timestamp": 123, "message": map[string]any{"id": "num", "model": "claude-haiku-4-5", "usage": map[string]any{"input_tokens": 1, "output_tokens": 1}, "content": []any{}}},
	}, now)
	health, err := readHealth(root, options(home))
	if err != nil {
		t.Fatal(err)
	}
	session := health.Sessions[0]
	if session.StartedAt == nil || *session.StartedAt != "2026-09-25T10:00:00.000Z" || session.LastActivityAt == nil || *session.LastActivityAt != "b-not-iso" {
		t.Fatalf("started %#v last %#v", session.StartedAt, session.LastActivityAt)
	}

	staleHome := homeOf(t)
	staleProject := sessions.ClaudeProjectDirectory(root, staleHome)
	path := writeSession(t, staleProject, "s1.jsonl", []any{
		assistant("m1", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 4, "output_tokens": 1}, "claude-haiku-4-5", nil),
	}, now)
	reader := sessions.NewReader()
	first, err := reader.ReadHealth(context.Background(), root, options(staleHome))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, mustJSONLine(t, assistant("m1", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 9, "output_tokens": 1}, "claude-haiku-4-5", nil)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, now, now); err != nil {
		t.Fatal(err)
	}
	second, err := reader.ReadHealth(context.Background(), root, options(staleHome))
	if err != nil {
		t.Fatal(err)
	}
	if first.Sessions[0].InputTokens.Number != 4 || second.Sessions[0].InputTokens.Number != 4 {
		t.Fatalf("first %v second %v", first.Sessions[0].InputTokens, second.Sessions[0].InputTokens)
	}
	reread, err := sessions.NewReader().ReadHealth(context.Background(), root, options(staleHome))
	if err != nil {
		t.Fatal(err)
	}
	if reread.Sessions[0].InputTokens.Number != 9 {
		t.Fatalf("new reader %v", reread.Sessions[0].InputTokens)
	}

	oldHome := homeOf(t)
	oldProject := sessions.ClaudeProjectDirectory(root, oldHome)
	writeSession(t, oldProject, "s1.jsonl", []any{assistant("m", "2026-09-01T00:00:00.000Z", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-haiku-4-5", nil)}, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	writeSession(t, filepath.Join(oldProject, "s1", "subagents"), "agent.jsonl", []any{
		assistant("m2", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 50, "output_tokens": 1}, "claude-haiku-4-5", nil),
	}, now)
	old, err := readHealth(root, options(oldHome))
	if err != nil {
		t.Fatal(err)
	}
	if len(old.Sessions) != 0 {
		t.Fatalf("%#v", old.Sessions)
	}

	freshHome := homeOf(t)
	freshProject := sessions.ClaudeProjectDirectory(root, freshHome)
	writeSession(t, freshProject, "s1.jsonl", []any{assistant("m", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-haiku-4-5", nil)}, now)
	writeSession(t, filepath.Join(freshProject, "s1", "subagents"), "agent.jsonl", []any{
		assistant("m2", "2026-09-01T00:00:00.000Z", map[string]any{"input_tokens": 50, "output_tokens": 1}, "claude-haiku-4-5", nil),
	}, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	fresh, err := readHealth(root, options(freshHome))
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh.Sessions) != 1 || fresh.Sessions[0].InputTokens.Number != 51 || fresh.Sessions[0].Subagents != 1 {
		t.Fatalf("%#v", fresh.Sessions)
	}
}

func TestReadSessionHealthLinkedWorktrees(t *testing.T) {
	home := homeOf(t)
	main := realPath(t, t.TempDir())
	git(t, main, "init", "-q", "-b", "develop")
	git(t, main, "-c", "user.name=tester", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init")
	linkedParent := realPath(t, t.TempDir())
	linked := filepath.Join(linkedParent, "feature path")
	git(t, main, "worktree", "add", "-q", "-b", "feature/add-thing", linked)
	usage := map[string]any{"input_tokens": 1, "output_tokens": 1}
	writeSession(t, sessions.ClaudeProjectDirectory(main, home), "in-main.jsonl", []any{
		assistant("m1", "2026-09-25T10:00:00.000Z", usage, "claude-haiku-4-5", nil),
	}, now)
	writeSession(t, sessions.ClaudeProjectDirectory(linked, home), "in-worktree.jsonl", []any{
		assistant("m2", "2026-09-25T11:00:00.000Z", usage, "claude-haiku-4-5", nil),
	}, now)
	health, err := readHealth(main, options(home))
	if err != nil {
		t.Fatal(err)
	}
	if len(health.Sessions) != 2 || health.Sessions[0].ID != "in-worktree" || health.Sessions[0].Worktree == nil || *health.Sessions[0].Worktree != "feature/add-thing" || health.Sessions[1].ID != "in-main" || health.Sessions[1].Worktree != nil {
		t.Fatalf("%#v", health.Sessions)
	}

	onlyHome := homeOf(t)
	writeSession(t, sessions.ClaudeProjectDirectory(linked, onlyHome), "only.jsonl", []any{
		assistant("m2", "2026-09-25T11:00:00.000Z", usage, "claude-haiku-4-5", nil),
	}, now)
	only, err := readHealth(main, options(onlyHome))
	if err != nil {
		t.Fatal(err)
	}
	mainDirectory := sessions.ClaudeProjectDirectory(main, onlyHome)
	if only.Directory == nil || *only.Directory != mainDirectory || len(only.Sessions) != 1 || only.Sessions[0].Worktree == nil || *only.Sessions[0].Worktree != "feature/add-thing" {
		t.Fatalf("directory %#v sessions %#v", only.Directory, only.Sessions)
	}
	if _, statErr := os.Stat(mainDirectory); !os.IsNotExist(statErr) {
		t.Fatalf("main log dir exists: %v", statErr)
	}

	fromLinked, err := readHealth(linked, options(home))
	if err != nil {
		t.Fatal(err)
	}
	if len(fromLinked.Sessions) != 2 || fromLinked.Sessions[0].ID != "in-worktree" || fromLinked.Sessions[0].Worktree != nil || fromLinked.Sessions[1].ID != "in-worktree" || fromLinked.Sessions[1].Worktree == nil || *fromLinked.Sessions[1].Worktree != "feature/add-thing" {
		t.Fatalf("%#v", fromLinked.Sessions)
	}
}

func TestFindSession(t *testing.T) {
	home := homeOf(t)
	writeSession(t, sessions.ClaudeProjectDirectory(root, home), "old.jsonl", []any{
		assistant("m0", "2026-08-01T00:00:00.000Z", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-opus-5-5", nil),
		map[string]any{"type": "ai-title", "aiTitle": "一覧を直す"},
	}, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))
	found, err := findSession(root, "old", sessions.FindOptions{Home: home})
	if err != nil || found == nil || found.Title == nil || *found.Title != "一覧を直す" || found.Worktree != nil || found.LastActivityAt == nil || *found.LastActivityAt != "2026-08-01T00:00:00.000Z" {
		t.Fatalf("%#v %v", found, err)
	}
	removed := "/Users/someone/worktrees/app-feature"
	writeSession(t, sessions.ClaudeProjectDirectory(removed, home), "gone.jsonl", []any{
		map[string]any{"type": "ai-title", "aiTitle": "worktree での作業"},
	}, now)
	missing, err := findSession(root, "gone", sessions.FindOptions{Home: home})
	if err != nil || missing != nil {
		t.Fatalf("%#v %v", missing, err)
	}
	gone, err := findSession(root, "gone", sessions.FindOptions{Home: home, Worktree: &removed})
	if err != nil || gone == nil || gone.Worktree == nil || *gone.Worktree != "app-feature" || gone.Title == nil || *gone.Title != "worktree での作業" {
		t.Fatalf("%#v %v", gone, err)
	}
	sameRoot := root
	same, err := findSession(root, "gone", sessions.FindOptions{Home: home, Worktree: &sameRoot})
	if err != nil || same != nil {
		t.Fatalf("%#v %v", same, err)
	}
	for _, id := range []string{"missing", "../s1", "", "s1.jsonl", "a/b", "a.b", "none", "s1 "} {
		found, findErr := findSession(root, id, sessions.FindOptions{Home: home})
		if findErr != nil || found != nil {
			t.Fatalf("id %q %#v %v", id, found, findErr)
		}
	}
	writeSession(t, sessions.ClaudeProjectDirectory(root, home), "s1.jsonl", []any{
		map[string]any{"type": "ai-title", "aiTitle": "latest title"},
	}, now)
	upper, err := findSession(root, "S1", sessions.FindOptions{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	_, statErr := os.Stat(filepath.Join(sessions.ClaudeProjectDirectory(root, home), "S1.jsonl"))
	if statErr == nil {
		if upper == nil || upper.ID != "S1" || upper.Title == nil || *upper.Title != "latest title" {
			t.Fatalf("%#v", upper)
		}
	} else if upper != nil {
		t.Fatalf("case sensitive lookup returned %#v", upper)
	}
}

func TestReadSessionHealthIgnoresYARUNow(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	fixed := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	since := fixed.Add(-7 * 24 * time.Hour)
	usage := map[string]any{"input_tokens": 1, "output_tokens": 1}
	writeSession(t, project, "in.jsonl", []any{assistant("m", "2026-09-28T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, since)
	writeSession(t, project, "out.jsonl", []any{assistant("m", "2026-09-21T00:00:00.000Z", usage, "claude-haiku-4-5", nil)}, since.Add(-time.Millisecond))
	t.Setenv("YARU_NOW", "not-a-time")
	health, err := readHealth(root, sessions.HealthOptions{Home: home, Now: fixed})
	if err != nil {
		t.Fatal(err)
	}
	if len(health.Sessions) != 1 || health.Sessions[0].ID != "in" || health.WindowDays != 7 {
		t.Fatalf("%#v", health.Sessions)
	}
}

func TestReadSessionHealthUsesGivenHome(t *testing.T) {
	home := homeOf(t)
	t.Setenv("HOME", t.TempDir())
	project := sessions.ClaudeProjectDirectory(root, home)
	writeSession(t, project, "s1.jsonl", []any{
		assistant("m", "2026-09-25T10:00:00.000Z", map[string]any{"input_tokens": 1, "output_tokens": 1}, "claude-haiku-4-5", nil),
	}, now)
	health, err := readHealth(root, sessions.HealthOptions{Home: home, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if len(health.Sessions) != 1 || health.Sessions[0].ID != "s1" {
		t.Fatalf("%#v", health)
	}
}

func TestSessionErrors(t *testing.T) {
	home := homeOf(t)
	project := sessions.ClaudeProjectDirectory(root, home)
	if err := os.MkdirAll(filepath.Join(project, "s1.jsonl"), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := readHealth(root, options(home))
	if err == nil || err.Error() != "EISDIR: illegal operation on a directory, read" {
		t.Fatalf("got %v", err)
	}

	fileHome := homeOf(t)
	parent := filepath.Join(fileHome, ".claude", "projects")
	if err := os.MkdirAll(parent, 0o755); err != nil {
		t.Fatal(err)
	}
	fileDirectory := filepath.Join(parent, strings.NewReplacer("/", "-", ".", "-").Replace(root))
	if err := os.WriteFile(fileDirectory, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = readHealth(root, options(fileHome))
	want := "ENOTDIR: not a directory, scandir '" + fileDirectory + "'"
	if err == nil || err.Error() != want {
		t.Fatalf("got %v want %s", err, want)
	}

	nullHome := homeOf(t)
	nullProject := sessions.ClaudeProjectDirectory(root, nullHome)
	writeRaw(t, nullProject, "s1.jsonl", "{\"type\":\"assistant\",\"timestamp\":\"2026-09-25T10:00:00.000Z\",\"message\":{\"content\":[null]}}\n")
	_, err = readHealth(root, options(nullHome))
	if err == nil || err.Error() != "TypeError: null is not an object (evaluating 'block.type')" {
		t.Fatalf("got %v", err)
	}

	textHome := homeOf(t)
	textProject := sessions.ClaudeProjectDirectory(root, textHome)
	writeRaw(t, textProject, "bad.jsonl", "{\"type\":\"user\",\"timestamp\":\"t\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":1}]}}\n")
	_, err = readHealth(root, options(textHome))
	if err == nil || err.Error() != "TypeError: block.text?.startsWith is not a function. (In 'block.text?.startsWith(INTERRUPTION_PREFIX)', 'block.text?.startsWith' is undefined)" {
		t.Fatalf("got %v", err)
	}
}

func git(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}

func mustJSONLine(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return append(encoded, '\n')
}

func writeRaw(t *testing.T, directory string, name string, text string) {
	t.Helper()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, name), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func realPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}
