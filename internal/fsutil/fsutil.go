// ファイルの作成、置き換え、排他、ディレクトリの一覧。
// 一時ファイルは os.CreateTemp の一意な名前にする。読んで直して書く処理は、パスごとの mutex と flock で守る。
// https://pubs.opengroup.org/onlinepubs/9699919799/functions/flock.html
package fsutil

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

var processLocks sync.Map

// Lock は path の読み書きを、このプロセスの中では mutex、プロセスの間では flock で直列化する。
// flock のファイルは一時ディレクトリに置く。本体の隣に .lock を残すと .yaru の一覧が変わるため。
// 本体を rename で置き換えても、ロックしている inode は変わらない。
func Lock(ctx context.Context, path string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key := filepath.Clean(path)
	actual, _ := processLocks.LoadOrStore(key, &sync.Mutex{})
	mutex := actual.(*sync.Mutex)
	mutex.Lock()
	locked := true
	releaseMutex := func() {
		if locked {
			locked = false
			mutex.Unlock()
		}
	}
	lockPath, err := lockFilePath(key)
	if err != nil {
		releaseMutex()
		return nil, err
	}
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o666)
	if err != nil {
		releaseMutex()
		return nil, err
	}
	if err := lockFile(ctx, file); err != nil {
		_ = file.Close()
		releaseMutex()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
		releaseMutex()
	}, nil
}

func lockFilePath(path string) (string, error) {
	sum := sha256.Sum256([]byte(path))
	directory := filepath.Join(os.TempDir(), "yaru-locks")
	if err := os.MkdirAll(directory, 0o777); err != nil {
		return "", err
	}
	return filepath.Join(directory, hex.EncodeToString(sum[:])+".lock"), nil
}

func lockFile(ctx context.Context, file *os.File) error {
	descriptor := int(file.Fd())
	for {
		err := syscall.Flock(descriptor, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return nil
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			return err
		}
		timer := time.NewTimer(5 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// WriteCreate は path を O_EXCL で作る。既にあれば os.ErrExist を返す。
// Node の writeFileSync は 0o666。umask はカーネルが掛ける。
func WriteCreate(path string, text string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteString(text)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

// WriteReplace は os.CreateTemp(dir, base+".*.tmp") に書いてから rename する。
// 固定の path+".tmp" は、同時に書くと相手の一時ファイルを消す。
func WriteReplace(path string, text string) error {
	directory := filepath.Dir(path)
	base := filepath.Base(path)
	file, err := os.CreateTemp(directory, base+".*.tmp")
	if err != nil {
		return err
	}
	temporary := file.Name()
	_, writeErr := file.WriteString(text)
	closeErr := file.Close()
	if writeErr != nil {
		_ = os.Remove(temporary)
		return writeErr
	}
	if closeErr != nil {
		_ = os.Remove(temporary)
		return closeErr
	}
	// CreateTemp は 0o600。writeFileSync の 0o666 に近づける。umask は chmod には掛からない
	if err := os.Chmod(temporary, 0o666); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

// ReadDir はディレクトリの項目名を、Node の readdir と同じくソートせずに返す。
func ReadDir(directory string) ([]string, error) {
	file, err := os.Open(directory)
	if err != nil {
		return nil, err
	}
	names, readErr := file.Readdirnames(-1)
	closeErr := file.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return names, nil
}
