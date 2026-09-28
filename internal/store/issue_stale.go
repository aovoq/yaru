//declscope:namespace issue

package store

import (
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/aovoq/yaru/internal/workspace"
)

// DefaultStaleAfterMilliseconds は config.yml に staleAfter が無いときの 24 時間。
// src/issue-stale.ts:8、docs/spec/yaru-format.md の「config.yml」。
const DefaultStaleAfterMilliseconds int64 = 24 * 3_600_000

var durationUnitMilliseconds = map[string]int64{
	"m": 60_000,
	"h": 3_600_000,
	"d": 86_400_000,
}

// ParseStaleAfter は 30m / 2h / 1d をミリ秒にする。0 と単位の無い値は拒む。
// src/issue-stale.ts:12-20
func ParseStaleAfter(value string) (int64, error) {
	if milliseconds, ok := parsePositiveDuration(javascriptTrim(value)); ok {
		return milliseconds, nil
	}
	quoted, err := quoteJavaScript(value)
	if err != nil {
		return 0, err
	}
	return 0, errString("invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual " + quoted)
}

// ReadStaleAfter は .yaru/config.yml の staleAfter を読む。無ければ 24 時間。
// 不正な値は一覧の 1 件を省くのではなく、呼び出し全体を失敗させる。
// src/issue-stale.ts:23-25、docs/spec/yaru-format.md の「config.yml」。
func ReadStaleAfter(space workspace.Workspace) (int64, error) {
	value, err := readConfigValue(space, "staleAfter")
	if err != nil {
		return 0, err
	}
	if value == nil {
		return DefaultStaleAfterMilliseconds, nil
	}
	return ParseStaleAfter(*value)
}

// IsIssueStale は進行中のまま staleAfter より長く更新されていないかを返す。等号では止まっていない。
// 日時として読めない updatedAt は古いと断定しない。src/issue-stale.ts:28-37
func IsIssueStale(status string, updatedAt string, now time.Time, staleAfterMilliseconds int64) bool {
	if status != "in_progress" {
		return false
	}
	parsed, ok := javascriptTime(updatedAt)
	if !ok {
		return false
	}
	return now.Sub(parsed) > time.Duration(staleAfterMilliseconds)*time.Millisecond
}

func parsePositiveDuration(value string) (int64, bool) {
	if len(value) < 2 {
		return 0, false
	}
	unit := value[len(value)-1:]
	multiplier, ok := durationUnitMilliseconds[unit]
	if !ok {
		return 0, false
	}
	digits := value[:len(value)-1]
	if digits == "" {
		return 0, false
	}
	for _, char := range digits {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	amount, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || amount <= 0 {
		return 0, false
	}
	if multiplier > 0 && amount > (1<<63-1)/multiplier {
		return 0, false
	}
	return amount * multiplier, true
}

// readConfigValue は config.yml の「key: value」の最初の行を読む。YAML の入れ子は見ない。
// 空の値は null で、次の行は見ない。src/config.ts:9-18
func readConfigValue(space workspace.Workspace, key string) (*string, error) {
	content, err := os.ReadFile(filepath.Join(space.Directory, "config.yml"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	prefix := key + ":"
	for _, line := range splitLines(string(content)) {
		if len(line) < len(prefix) || line[:len(prefix)] != prefix {
			continue
		}
		value := javascriptTrim(line[len(prefix):])
		if value == "" {
			return nil, nil
		}
		return stringPointer(value), nil
	}
	return nil, nil
}
