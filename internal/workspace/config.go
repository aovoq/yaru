//declscope:core

package workspace

import (
	"os"
	"strings"
)

// ReadConfigValue は TS 版の readConfigValue と同じく、config.yml の「key: value」を 1 行ずつ読む
// 値の中の「:」は区切りとみなさない。空の値は null で、次の行は見ない
// src/config.ts:9-18 docs/spec/yaru-format.md の「config.yml」
// https://yaml.org/spec/1.2.2/#flow-scalar-styles
func ReadConfigValue(workspace Workspace, key string) (string, bool) {
	data, err := os.ReadFile(nodeJoin(workspace.Directory, "config.yml"))
	if err != nil {
		return "", false
	}
	prefix := key + ":"
	for _, line := range strings.Split(decodeUTF8(data), "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		value := javascriptTrim(line[len(prefix):])
		if value == "" {
			return "", false
		}
		return value, true
	}
	return "", false
}
