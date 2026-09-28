//declscope:core

package workspace

import (
	"bytes"
	"errors"
	"io"
	"os"
	"os/exec"
)

// Bun が cwd に git を起動できなかったときの Error.message
// src/store.ts:140-144 src/provenance.ts:37-40
var (
	errGitNotDirectory     = errors.New("ENOTDIR: not a directory, posix_spawn 'git'")
	errGitMissingDirectory = errors.New("ENOENT: no such file or directory, posix_spawn 'git'")
)

// executeGit は Bun.spawnSync(["git", ...], { cwd, stdout: "pipe", stderr: "ignore" }) に当たる
// 起動できなければ error。終了コードが 0 でなければ exitCode だけを返し、error は nil
func executeGit(workingDirectory string, args ...string) (string, int, error) {
	if err := gitDirectoryError(workingDirectory); err != nil {
		return "", -1, err
	}
	command := exec.Command("git", args...)
	command.Dir = workingDirectory
	command.Stderr = io.Discard
	var stdout bytes.Buffer
	command.Stdout = &stdout
	err := command.Run()
	if err == nil {
		return stdout.String(), 0, nil
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return stdout.String(), exitError.ExitCode(), nil
	}
	return stdout.String(), -1, err
}

func gitDirectoryError(workingDirectory string) error {
	info, err := os.Stat(workingDirectory)
	if err != nil {
		if os.IsNotExist(err) {
			return errGitMissingDirectory
		}
		return err
	}
	if !info.IsDir() {
		return errGitNotDirectory
	}
	return nil
}

// gitText は標準出力を trim し、失敗か空なら nil を返す
// src/provenance.ts:37-40
func gitText(workingDirectory string, args ...string) (*string, error) {
	stdout, exitCode, err := executeGit(workingDirectory, args...)
	if err != nil {
		return nil, err
	}
	if exitCode != 0 {
		return nil, nil
	}
	trimmed := javascriptTrim(stdout)
	if trimmed == "" {
		return nil, nil
	}
	return &trimmed, nil
}
