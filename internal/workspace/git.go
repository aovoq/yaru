//declscope:core

package workspace

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"syscall"

	"github.com/aovoq/yaru/internal/document"
)

// Bun が cwd に git を起動できなかったときの Error.message
// src/store.ts:140-144 src/provenance.ts:37-40 src/repository.ts:150-153
var (
	errGitNotDirectory     = errors.New("ENOTDIR: not a directory, posix_spawn 'git'")
	errGitMissingDirectory = errors.New("ENOENT: no such file or directory, posix_spawn 'git'")
	errGitPermission       = errors.New("EACCES: permission denied, posix_spawn 'git'")
)

// RunGit は git を 1 か所で起動する。起動できなければ posix_spawn の文言にする。
// 終了コードが 0 でなければ exitCode だけを返し、error は nil。標準エラーは捨てる。
// src/store.ts:140-144 src/repository.ts:150-153
func RunGit(ctx context.Context, workingDirectory string, args ...string) (string, int, error) {
	if err := ctx.Err(); err != nil {
		return "", -1, err
	}
	if err := gitDirectoryError(workingDirectory); err != nil {
		return "", -1, err
	}
	command := exec.CommandContext(ctx, "git", args...)
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
	return stdout.String(), -1, gitSpawnError(err)
}

func gitDirectoryError(workingDirectory string) error {
	info, err := os.Stat(workingDirectory)
	if err != nil {
		if os.IsNotExist(err) {
			return errGitMissingDirectory
		}
		if os.IsPermission(err) {
			return errGitPermission
		}
		return err
	}
	if !info.IsDir() {
		return errGitNotDirectory
	}
	return nil
}

func gitSpawnError(err error) error {
	if errors.Is(err, exec.ErrNotFound) || os.IsNotExist(err) {
		return errGitMissingDirectory
	}
	if os.IsPermission(err) {
		return errGitPermission
	}
	if errors.Is(err, syscall.ENOTDIR) {
		return errGitNotDirectory
	}
	return err
}

// gitText は標準出力を trim し、失敗か空なら nil を返す
// src/provenance.ts:37-40
func gitText(ctx context.Context, workingDirectory string, args ...string) (*string, error) {
	stdout, exitCode, err := RunGit(ctx, workingDirectory, args...)
	if err != nil {
		return nil, err
	}
	if exitCode != 0 {
		return nil, nil
	}
	trimmed := document.Trim(stdout)
	if trimmed == "" {
		return nil, nil
	}
	return &trimmed, nil
}
