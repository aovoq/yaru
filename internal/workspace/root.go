//declscope:core

package workspace

import (
	"os"
	"path/filepath"
	"strings"
)

// FindRoot は TS 版の findRoot と同じく、作業ディレクトリから .yaru のあるルートを探す
// linked worktree では main worktree の同じ相対位置を先に見る
// src/store.ts:121-159 docs/spec/yaru-format.md の「worktree」
// https://git-scm.com/docs/git-worktree
func FindRoot(start string) (string, error) {
	original, err := originalFolderRoot(start)
	if err != nil {
		return "", err
	}
	if original != "" {
		return original, nil
	}
	directory := start
	for {
		if exists(nodeJoin(directory, ".yaru", "config.yml")) {
			return directory, nil
		}
		parent := nodeDirname(directory)
		if parent == directory {
			return "", errNotWorkspace
		}
		directory = parent
	}
}

// originalFolderRoot は linked worktree の位置を main worktree の同じ位置へ写す。写せなければ空
// src/store.ts:137-159
func originalFolderRoot(start string) (string, error) {
	// まだ無いディレクトリでは git を起動できないので、上へ探す通常の方法に任せる
	info, err := os.Stat(start)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if !info.IsDir() {
		return "", errGitNotDirectory
	}
	stdout, exitCode, err := executeGit(start, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir")
	if err != nil {
		return "", err
	}
	if exitCode != 0 {
		return "", nil
	}
	lines := strings.Split(javascriptTrim(stdout), "\n")
	worktreeTop := ""
	commonDirectory := ""
	if len(lines) > 0 {
		worktreeTop = lines[0]
	}
	if len(lines) > 1 {
		commonDirectory = lines[1]
	}
	if worktreeTop == "" || commonDirectory == "" {
		return "", nil
	}
	// bare リポジトリから作った worktree には元のフォルダが無い
	if nodeBasename(commonDirectory) != ".git" {
		return "", nil
	}
	originalTop := nodeDirname(commonDirectory)
	if originalTop == worktreeTop {
		return "", nil
	}
	directory, err := filepath.EvalSymlinks(start)
	if err != nil {
		return "", err
	}
	for {
		inside := nodeRelative(worktreeTop, directory)
		if strings.HasPrefix(inside, "..") {
			return "", nil
		}
		mapped := nodeJoin(originalTop, inside)
		if exists(nodeJoin(mapped, ".yaru", "config.yml")) {
			return mapped, nil
		}
		if directory == worktreeTop {
			return "", nil
		}
		directory = nodeDirname(directory)
	}
}
