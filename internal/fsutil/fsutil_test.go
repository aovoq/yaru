package fsutil

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestWriteReplaceUsesAUniqueTemporaryName(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "1.md")
	if err := WriteReplace(path, "one"); err != nil {
		t.Fatal(err)
	}
	if err := WriteReplace(path, "two"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "two" {
		t.Fatalf("content: %q", content)
	}
	matches, err := filepath.Glob(filepath.Join(directory, "*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary files remain: %v", matches)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("fixed temporary name was used")
	}
}

func TestWriteCreateIsExclusive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "1.md")
	if err := WriteCreate(path, "first"); err != nil {
		t.Fatal(err)
	}
	err := WriteCreate(path, "second")
	if !os.IsExist(err) {
		t.Fatalf("expected exist, got %v", err)
	}
	content, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(content) != "first" {
		t.Fatalf("content: %q", content)
	}
}

func TestLockSerializesReadModifyWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "issue.md")
	if err := os.WriteFile(path, []byte("0"), 0o666); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			unlock, err := Lock(context.Background(), path)
			if err != nil {
				t.Error(err)
				return
			}
			defer unlock()
			content, err := os.ReadFile(path)
			if err != nil {
				t.Error(err)
				return
			}
			next := append(bytes.TrimSpace(content), 'x')
			if err := WriteReplace(path, string(next)); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "0xxxxxxxx" {
		t.Fatalf("lost updates: %q", content)
	}
}

func TestLockDoesNotLeaveAFileNextToTheData(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "1.md")
	if err := os.WriteFile(path, []byte("x"), 0o666); err != nil {
		t.Fatal(err)
	}
	unlock, err := Lock(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	matches, err := filepath.Glob(filepath.Join(directory, "*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || matches[0] != path {
		t.Fatalf("directory: %v", matches)
	}
}

func TestReadDirKeepsDirectoryOrder(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"b.md", "a.md"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("x"), 0o666); err != nil {
			t.Fatal(err)
		}
	}
	names, err := ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 {
		t.Fatalf("names: %v", names)
	}
}
