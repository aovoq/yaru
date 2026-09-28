package golden

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"unicode/utf8"
)

type Snapshot struct {
	Name  string         `json:"name"`
	Steps []RecordedStep `json:"steps"`
	Yaru  []RecordedFile `json:"yaru"`
	State []RecordedFile `json:"state"`
}

// 古い記録は stdin から workingDirectory までを持たない。読むときは空として扱う
type RecordedStep struct {
	Arguments        []string          `json:"arguments"`
	Stdin            string            `json:"stdin"`
	Environment      map[string]string `json:"environment"`
	Now              string            `json:"now"`
	WorkingDirectory string            `json:"workingDirectory"`
	Stdout           string            `json:"stdout"`
	Stderr           string            `json:"stderr"`
	ExitCode         int               `json:"exitCode"`
}

// 空のディレクトリは Directory を true にし、Content を空にする
type RecordedFile struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Directory bool   `json:"directory"`
}

func ReadSnapshot(path string) (Snapshot, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Snapshot{}, fmt.Errorf("missing snapshot: expected %s, actual file not found", path)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(content, &fields); err != nil || !isString(fields["name"]) || !bytes.HasPrefix(bytes.TrimSpace(fields["steps"]), []byte("[")) {
		return Snapshot{}, fmt.Errorf("invalid snapshot: expected name and steps, actual %s", path)
	}
	snapshot := Snapshot{}
	if err := json.Unmarshal(content, &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("invalid snapshot: expected name and steps, actual %s: %w", path, err)
	}
	if snapshot.Yaru == nil {
		snapshot.Yaru = []RecordedFile{}
	}
	if snapshot.State == nil {
		snapshot.State = []RecordedFile{}
	}
	return snapshot, nil
}

// EncodeSnapshot は TS 版の `${JSON.stringify(snapshot, null, 2)}\n` と同じバイトを返す
// encoding/json は <>& と U+2028 を \u にし、\b と \f の書き方も版で変わるので、自前で書く
// https://tc39.es/ecma262/#sec-json.stringify
func EncodeSnapshot(snapshot Snapshot) []byte {
	var buffer bytes.Buffer
	buffer.WriteString("{\n")
	writeMember(&buffer, 1, "name", encodeString(snapshot.Name), false)
	writeArray(&buffer, 1, "steps", len(snapshot.Steps), func(index int, indent int) {
		writeStep(&buffer, indent, snapshot.Steps[index])
	}, false)
	writeArray(&buffer, 1, "yaru", len(snapshot.Yaru), func(index int, indent int) {
		writeRecordedFile(&buffer, indent, snapshot.Yaru[index])
	}, false)
	writeArray(&buffer, 1, "state", len(snapshot.State), func(index int, indent int) {
		writeRecordedFile(&buffer, indent, snapshot.State[index])
	}, true)
	buffer.WriteString("}\n")
	return buffer.Bytes()
}

func writeStep(buffer *bytes.Buffer, indent int, step RecordedStep) {
	writeIndent(buffer, indent)
	buffer.WriteString("{\n")
	writeArray(buffer, indent+1, "arguments", len(step.Arguments), func(index int, itemIndent int) {
		writeIndent(buffer, itemIndent)
		buffer.Write(encodeString(step.Arguments[index]))
	}, false)
	writeMember(buffer, indent+1, "stdin", encodeString(step.Stdin), false)
	writeIndent(buffer, indent+1)
	buffer.WriteString(`"environment": `)
	writeEnvironment(buffer, indent+1, step.Environment)
	buffer.WriteString(",\n")
	writeMember(buffer, indent+1, "now", encodeString(step.Now), false)
	writeMember(buffer, indent+1, "workingDirectory", encodeString(step.WorkingDirectory), false)
	writeMember(buffer, indent+1, "stdout", encodeString(step.Stdout), false)
	writeMember(buffer, indent+1, "stderr", encodeString(step.Stderr), false)
	writeMember(buffer, indent+1, "exitCode", []byte(strconv.Itoa(step.ExitCode)), true)
	writeIndent(buffer, indent)
	buffer.WriteString("}")
}

// 環境変数はキーの順に並べる。記録の手順ごとの差が並び順で出ないようにする
func writeEnvironment(buffer *bytes.Buffer, indent int, environment map[string]string) {
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		buffer.WriteString("{}")
		return
	}
	buffer.WriteString("{\n")
	for index, key := range keys {
		writeMember(buffer, indent+1, key, encodeString(environment[key]), index == len(keys)-1)
	}
	writeIndent(buffer, indent)
	buffer.WriteString("}")
}

func writeRecordedFile(buffer *bytes.Buffer, indent int, file RecordedFile) {
	writeIndent(buffer, indent)
	buffer.WriteString("{\n")
	writeMember(buffer, indent+1, "path", encodeString(file.Path), false)
	writeMember(buffer, indent+1, "content", encodeString(file.Content), !file.Directory)
	if file.Directory {
		writeMember(buffer, indent+1, "directory", []byte("true"), true)
	}
	writeIndent(buffer, indent)
	buffer.WriteString("}")
}

func writeArray(buffer *bytes.Buffer, indent int, key string, length int, writeItem func(index int, indent int), last bool) {
	writeIndent(buffer, indent)
	buffer.Write(encodeString(key))
	if length == 0 {
		buffer.WriteString(": []")
	} else {
		buffer.WriteString(": [\n")
		for index := 0; index < length; index++ {
			writeItem(index, indent+1)
			if index < length-1 {
				buffer.WriteString(",")
			}
			buffer.WriteString("\n")
		}
		writeIndent(buffer, indent)
		buffer.WriteString("]")
	}
	if !last {
		buffer.WriteString(",")
	}
	buffer.WriteString("\n")
}

func writeMember(buffer *bytes.Buffer, indent int, key string, value []byte, last bool) {
	writeIndent(buffer, indent)
	buffer.Write(encodeString(key))
	buffer.WriteString(": ")
	buffer.Write(value)
	if !last {
		buffer.WriteString(",")
	}
	buffer.WriteString("\n")
}

func writeIndent(buffer *bytes.Buffer, indent int) {
	for range indent {
		buffer.WriteString("  ")
	}
}

// encodeString は QuoteJSONString。制御文字は \b \t \n \f \r か小文字の \u00xx にし、それ以外はそのまま書く
// Go の文字列は UTF-8 なので、JS の孤立したサロゲートは現れない。記録する前に decodeUTF8 を通している
// https://tc39.es/ecma262/#sec-quotejsonstring
//
//declscope:package
func encodeString(value string) []byte {
	const hexadecimal = "0123456789abcdef"
	buffer := make([]byte, 0, len(value)+2)
	buffer = append(buffer, '"')
	for index := 0; index < len(value); {
		character, size := utf8.DecodeRuneInString(value[index:])
		switch {
		case character == '"':
			buffer = append(buffer, '\\', '"')
		case character == '\\':
			buffer = append(buffer, '\\', '\\')
		case character == '\b':
			buffer = append(buffer, '\\', 'b')
		case character == '\t':
			buffer = append(buffer, '\\', 't')
		case character == '\n':
			buffer = append(buffer, '\\', 'n')
		case character == '\f':
			buffer = append(buffer, '\\', 'f')
		case character == '\r':
			buffer = append(buffer, '\\', 'r')
		case character < 0x20:
			buffer = append(buffer, '\\', 'u', '0', '0', hexadecimal[character>>4], hexadecimal[character&0xf])
		default:
			buffer = append(buffer, value[index:index+size]...)
		}
		index += size
	}
	return append(buffer, '"')
}
