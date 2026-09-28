//declscope:core

package workspace

import (
	"os"
	"strings"
)

// Node の path.posix。filepath.Dir は `..` を先に畳むので、findRoot の親歩きとずれる
// src/store.ts:121-159 は dirname と relative と join をそのまま使っている

func nodeJoin(elements ...string) string {
	joined := ""
	started := false
	for _, element := range elements {
		if element == "" {
			continue
		}
		if !started {
			joined = element
			started = true
			continue
		}
		joined += "/" + element
	}
	if !started {
		return "."
	}
	return nodeNormalize(joined)
}

func nodeNormalize(path string) string {
	if path == "" {
		return "."
	}
	absolute := path[0] == '/'
	trailingSeparator := path[len(path)-1] == '/'
	var parts []string
	for _, part := range strings.Split(path, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			if len(parts) > 0 && parts[len(parts)-1] != ".." {
				parts = parts[:len(parts)-1]
				continue
			}
			if !absolute {
				parts = append(parts, "..")
			}
			continue
		}
		parts = append(parts, part)
	}
	normalized := strings.Join(parts, "/")
	if absolute {
		normalized = "/" + normalized
	}
	if trailingSeparator && (normalized == "" || normalized[len(normalized)-1] != '/') {
		normalized += "/"
	}
	if normalized == "" {
		return "."
	}
	return normalized
}

func nodeResolve(path string) string {
	if path == "" || path[0] != '/' {
		workingDirectory, err := WorkingDirectory()
		if err != nil || workingDirectory == "" {
			path = "/" + path
		} else {
			path = workingDirectory + "/" + path
		}
	}
	return nodeNormalize(path)
}

func nodeRelative(from string, to string) string {
	if from == to {
		return ""
	}
	from = nodeResolve(from)
	to = nodeResolve(to)
	if from == to {
		return ""
	}
	fromParts := splitAbsolute(from)
	toParts := splitAbsolute(to)
	same := 0
	for same < len(fromParts) && same < len(toParts) && fromParts[same] == toParts[same] {
		same++
	}
	parts := make([]string, 0, len(fromParts)-same+len(toParts)-same)
	for index := same; index < len(fromParts); index++ {
		parts = append(parts, "..")
	}
	parts = append(parts, toParts[same:]...)
	return strings.Join(parts, "/")
}

func splitAbsolute(path string) []string {
	if path == "/" || path == "" {
		return nil
	}
	return strings.Split(strings.TrimPrefix(path, "/"), "/")
}

func nodeDirname(path string) string {
	if path == "" {
		return "."
	}
	end := -1
	matchedSlash := true
	for index := len(path) - 1; index >= 1; index-- {
		if path[index] == '/' {
			if !matchedSlash {
				end = index
				break
			}
			continue
		}
		matchedSlash = false
	}
	if end == -1 {
		if path[0] == '/' {
			return "/"
		}
		return "."
	}
	if end == 1 && path[0] == '/' {
		return "//"
	}
	return path[:end]
}

func nodeBasename(path string) string {
	start := 0
	end := -1
	matchedSlash := true
	for index := len(path) - 1; index >= 0; index-- {
		if path[index] == '/' {
			if !matchedSlash {
				start = index + 1
				break
			}
			continue
		}
		if end == -1 {
			matchedSlash = false
			end = index + 1
		}
	}
	if end == -1 {
		return ""
	}
	return path[start:end]
}

// exists は Node の existsSync。エラーも「無い」になり、ディレクトリでも true
// src/store.ts:126 src/store.ts:164
func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
