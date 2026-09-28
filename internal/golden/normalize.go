package golden

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// 実行のたびに変わる一時ディレクトリを、記録の中では固定の置き換え文字にする
// macOS では /tmp や /var が /private 付きの実パスになるので、両方を同じ文字へ寄せる

type WorktreeBinding struct {
	Name      string
	Directory string
}

type CommitBinding struct {
	Full  string
	Short string
}

// 空の項目は置き換えない
type Bindings struct {
	WorkspaceDirectory string
	StateDirectory     string
	Worktrees          []WorktreeBinding
	// 診断がリポジトリの絶対パスを出すことがある。チェックアウト先が違っても記録がずれないようにする
	RepositoryDirectory string
	HomeDirectory       string
	// 準備で作った commit。40 桁と短縮形を、古い順に <COMMIT:1> から置き換える
	Commits []CommitBinding
}

type replacement struct {
	from string
	to   string
}

func NormalizeText(text string, bindings Bindings) string {
	replacements := []replacement{}
	add := func(directory string, placeholder string) {
		if directory == "" {
			return
		}
		for _, variant := range pathVariants(directory) {
			replacements = append(replacements, replacement{from: variant, to: placeholder})
		}
	}
	add(bindings.WorkspaceDirectory, "<WORKSPACE>")
	add(bindings.StateDirectory, "<STATE>")
	for _, worktree := range bindings.Worktrees {
		add(worktree.Directory, "<WORKTREE:"+worktree.Name+">")
	}
	add(bindings.RepositoryDirectory, "<REPOSITORY>")
	add(bindings.HomeDirectory, "<HOME>")
	// 作業ツリーのパスがワークスペースのパスを含むとき、短い方を先に替えると長い方が壊れる
	// 同じ長さは足した順のまま (Array.prototype.sort は安定)
	sort.SliceStable(replacements, func(left int, right int) bool {
		return len(replacements[left].from) > len(replacements[right].from)
	})
	normalized := text
	for _, item := range replacements {
		if len(item.from) < 2 {
			continue
		}
		normalized = strings.ReplaceAll(normalized, item.from, item.to)
	}
	return replaceCommits(normalized, bindings.Commits)
}

func replaceCommits(text string, commits []CommitBinding) string {
	normalized := text
	// 完全なハッシュを先に消す。短縮形は別のハッシュの先頭にもなり得るので、境界を見てから替える
	for index, commit := range commits {
		normalized = replaceHash(normalized, commit.Full, fmt.Sprintf("<COMMIT:%d>", index+1))
	}
	for index, commit := range commits {
		normalized = replaceHash(normalized, commit.Short, fmt.Sprintf("<COMMIT:%d>", index+1))
	}
	return normalized
}

// replaceHash は前後が 16 進の文字でないところだけを替える
func replaceHash(text string, hash string, placeholder string) string {
	if len(hash) < 4 || !isHexadecimal(hash) {
		return text
	}
	var builder strings.Builder
	cursor := 0
	for {
		found := strings.Index(text[cursor:], hash)
		if found < 0 {
			break
		}
		start := cursor + found
		end := start + len(hash)
		before := start == 0 || !isHexadecimalByte(text[start-1])
		after := end == len(text) || !isHexadecimalByte(text[end])
		if before && after {
			builder.WriteString(text[cursor:start])
			builder.WriteString(placeholder)
			cursor = end
			continue
		}
		builder.WriteString(text[cursor : start+1])
		cursor = start + 1
	}
	builder.WriteString(text[cursor:])
	return builder.String()
}

func isHexadecimal(text string) bool {
	for index := 0; index < len(text); index++ {
		if !isHexadecimalByte(text[index]) {
			return false
		}
	}
	return true
}

func isHexadecimalByte(character byte) bool {
	return ('0' <= character && character <= '9') || ('a' <= character && character <= 'f') || ('A' <= character && character <= 'F')
}

// pathVariants は渡された表記、実パス、/private の有り無しを返す
func pathVariants(directory string) []string {
	variants := []string{directory}
	if resolved, err := filepath.EvalSymlinks(directory); err == nil {
		variants = appendUnique(variants, resolved)
	}
	for _, path := range append([]string{}, variants...) {
		if strings.HasPrefix(path, "/private/") {
			variants = appendUnique(variants, strings.TrimPrefix(path, "/private"))
		} else if strings.HasPrefix(path, "/") {
			variants = appendUnique(variants, "/private"+path)
		}
	}
	return variants
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
