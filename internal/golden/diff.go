package golden

import (
	"fmt"
	"strings"
)

// Myers の最短編集から unified diff を作る。行番号で突き合わせると、1 行の挿入が後ろを全部差分にしてしまう
// 行末の空白と CR は画面では見えないので、その変更は JSON の文字列として出す
// https://www.gnu.org/software/diffutils/manual/html_node/Unified-Format.html
const (
	diffContext   = 3
	diffLineLimit = 200
)

type editKind int

const (
	editEqual editKind = iota
	editDelete
	editInsert
)

type edit struct {
	kind         editKind
	text         string
	expectedLine int
	actualLine   int
}

//declscope:package
func unifiedDiff(expected string, actual string) string {
	edits := numberEdits(myersDiff(splitLines(expected), splitLines(actual)))
	visible := make([]bool, len(edits))
	for index, item := range edits {
		if item.kind == editEqual {
			continue
		}
		for cursor := max(0, index-diffContext); cursor <= min(len(edits)-1, index+diffContext); cursor++ {
			visible[cursor] = true
		}
	}
	output := []string{"--- expected", "+++ actual"}
	shown := 0
	for index := 0; index < len(edits); {
		if !visible[index] {
			index++
			continue
		}
		end := index
		for end < len(edits) && visible[end] {
			end++
		}
		hunk := edits[index:end]
		output = append(output, hunkHeader(hunk))
		for _, line := range renderHunk(hunk) {
			if shown >= diffLineLimit {
				output = append(output, "... diff truncated")
				return strings.Join(output, "\n")
			}
			output = append(output, line)
			shown++
		}
		index = end
	}
	// 行の中身は同じで末尾の改行だけが違うとき、hunk が空になるので目印を出す
	if expected != actual && !containsChangedLine(output) {
		output = append(output, `\ No newline at end of file`)
	}
	return strings.Join(output, "\n")
}

func splitLines(text string) []string {
	if text == "" {
		return []string{}
	}
	return strings.Split(strings.TrimSuffix(text, "\n"), "\n")
}

// myersDiff は深さごとの到達点を残し、終点から逆にたどって編集を組み立てる
// http://www.xmailserver.org/diff2.pdf
func myersDiff(expected []string, actual []string) []edit {
	expectedLength := len(expected)
	actualLength := len(actual)
	limit := expectedLength + actualLength
	trace := []map[int]int{}
	furthest := map[int]int{1: 0}
	for depth := 0; depth <= limit; depth++ {
		trace = append(trace, copyFurthest(furthest))
		reached := false
		for diagonal := -depth; diagonal <= depth; diagonal += 2 {
			before := furthest[diagonal-1]
			after := furthest[diagonal+1]
			x := before + 1
			if diagonal == -depth || (diagonal != depth && before < after) {
				x = after
			}
			y := x - diagonal
			for x < expectedLength && y < actualLength && expected[x] == actual[y] {
				x++
				y++
			}
			furthest[diagonal] = x
			if x >= expectedLength && y >= actualLength {
				reached = true
				break
			}
		}
		if reached {
			break
		}
	}
	edits := []edit{}
	x := expectedLength
	y := actualLength
	for depth := len(trace) - 1; depth >= 0; depth-- {
		snapshot := trace[depth]
		diagonal := x - y
		before := valueOr(snapshot, diagonal-1, -1)
		after := valueOr(snapshot, diagonal+1, -1)
		previousDiagonal := diagonal - 1
		if diagonal == -depth || (diagonal != depth && before < after) {
			previousDiagonal = diagonal + 1
		}
		previousX := snapshot[previousDiagonal]
		previousY := previousX - previousDiagonal
		for x > previousX && y > previousY {
			x--
			y--
			edits = append(edits, edit{kind: editEqual, text: expected[x]})
		}
		if depth == 0 {
			break
		}
		if x == previousX {
			y--
			edits = append(edits, edit{kind: editInsert, text: actual[y]})
		} else {
			x--
			edits = append(edits, edit{kind: editDelete, text: expected[x]})
		}
	}
	for left, right := 0, len(edits)-1; left < right; left, right = left+1, right-1 {
		edits[left], edits[right] = edits[right], edits[left]
	}
	return edits
}

func copyFurthest(source map[int]int) map[int]int {
	copied := make(map[int]int, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}

func valueOr(values map[int]int, key int, fallback int) int {
	if value, present := values[key]; present {
		return value
	}
	return fallback
}

func numberEdits(edits []edit) []edit {
	expectedLine := 1
	actualLine := 1
	for index := range edits {
		edits[index].expectedLine = expectedLine
		edits[index].actualLine = actualLine
		if edits[index].kind != editInsert {
			expectedLine++
		}
		if edits[index].kind != editDelete {
			actualLine++
		}
	}
	return edits
}

func hunkHeader(hunk []edit) string {
	expectedStart, expectedCount := hunk[0].expectedLine, 0
	actualStart, actualCount := hunk[0].actualLine, 0
	expectedFound, actualFound := false, false
	for _, item := range hunk {
		if item.kind != editInsert {
			if !expectedFound {
				expectedStart, expectedFound = item.expectedLine, true
			}
			expectedCount++
		}
		if item.kind != editDelete {
			if !actualFound {
				actualStart, actualFound = item.actualLine, true
			}
			actualCount++
		}
	}
	return fmt.Sprintf("@@ -%d,%d +%d,%d @@", expectedStart, expectedCount, actualStart, actualCount)
}

func renderHunk(hunk []edit) []string {
	lines := []string{}
	for index := 0; index < len(hunk); {
		if hunk[index].kind == editEqual {
			lines = append(lines, " "+hunk[index].text)
			index++
			continue
		}
		group := []edit{}
		for index < len(hunk) && hunk[index].kind != editEqual {
			group = append(group, hunk[index])
			index++
		}
		reveal := false
		for _, item := range group {
			if needsReveal(item.text) {
				reveal = true
			}
		}
		for _, item := range group {
			prefix := "+"
			if item.kind == editDelete {
				prefix = "-"
			}
			text := item.text
			if reveal {
				text = string(encodeString(text))
			}
			lines = append(lines, prefix+text)
		}
	}
	return lines
}

func containsChangedLine(lines []string) bool {
	for _, line := range lines {
		if (strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++")) || (strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---")) {
			return true
		}
	}
	return false
}

func needsReveal(text string) bool {
	return strings.HasSuffix(text, " ") || strings.HasSuffix(text, "\t") || strings.Contains(text, "\r")
}
