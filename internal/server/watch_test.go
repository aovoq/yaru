//declscope:core

package server

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	connect "connectrpc.com/connect"
	v1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
)

type watchMessage struct {
	message *v1.WatchWorkspaceResponse
	err     error
}

func TestWatchReadyChangeAndNoQuestionDirectory(t *testing.T) {
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	slug, root := initWorkspace(t, stateDirectory, "watched")
	_, otherRoot := initWorkspace(t, stateDirectory, "other")
	built := newTestServer(t, Configuration{Ephemeral: true, WatchPoll: 15 * time.Millisecond, Heartbeat: time.Hour})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	client := yaruv1connect.NewWatchServiceClient(http.DefaultClient, running.URL())
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	t.Cleanup(cancel)
	stream, err := client.WatchWorkspace(ctx, connect.NewRequest(&v1.WatchWorkspaceRequest{Workspace: slug}))
	if err != nil {
		t.Fatal(err)
	}
	messages := readWatchMessages(stream)
	first := readWatch(t, messages, 2*time.Second)
	if first.GetReady() == nil {
		t.Fatalf("first event: expected ready, actual %#v", first.GetEvent())
	}
	if _, statErr := os.Stat(filepath.Join(root, ".yaru", "questions")); !os.IsNotExist(statErr) {
		t.Fatal("watch created .yaru/questions")
	}
	if err := os.WriteFile(filepath.Join(root, ".yaru", "config.yml"), []byte("publicUrl: https://evil.example\nname: touched\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectNoWatch(t, messages, 400*time.Millisecond)
	if err := os.WriteFile(filepath.Join(otherRoot, ".yaru", "issues", "1.md"), []byte("other"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectNoWatch(t, messages, 400*time.Millisecond)
	if err := os.WriteFile(filepath.Join(root, ".yaru", "issues", "1.md"), []byte("issue"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed := readWatch(t, messages, 2*time.Second)
	if changed.GetChange() == nil {
		t.Fatalf("event: expected change, actual %#v", changed.GetEvent())
	}
	if err := os.MkdirAll(filepath.Join(root, ".yaru", "comments"), 0o755); err != nil {
		t.Fatal(err)
	}
	created := readWatch(t, messages, 2*time.Second)
	if created.GetChange() == nil {
		t.Fatalf("comments directory: expected change, actual %#v", created.GetEvent())
	}
	if err := os.WriteFile(filepath.Join(root, ".yaru", "comments", "1.md"), []byte("comment"), 0o644); err != nil {
		t.Fatal(err)
	}
	comment := readWatch(t, messages, 2*time.Second)
	if comment.GetChange() == nil {
		t.Fatalf("comment file: expected change, actual %#v", comment.GetEvent())
	}
}

func TestWatchSeesFilesWhenIssuesDirectoryIsMissing(t *testing.T) {
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	slug, root := initWorkspace(t, stateDirectory, "fallback")
	if err := os.RemoveAll(filepath.Join(root, ".yaru", "issues")); err != nil {
		t.Fatal(err)
	}
	built := newTestServer(t, Configuration{Ephemeral: true, WatchPoll: 15 * time.Millisecond, Heartbeat: time.Hour})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	client := yaruv1connect.NewWatchServiceClient(http.DefaultClient, running.URL())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	stream, err := client.WatchWorkspace(ctx, connect.NewRequest(&v1.WatchWorkspaceRequest{Workspace: slug}))
	if err != nil {
		t.Fatal(err)
	}
	messages := readWatchMessages(stream)
	if readWatch(t, messages, 2*time.Second).GetReady() == nil {
		t.Fatal("expected ready")
	}
	if err := os.WriteFile(filepath.Join(root, ".yaru", "note.txt"), []byte("note"), 0o644); err != nil {
		t.Fatal(err)
	}
	if readWatch(t, messages, 2*time.Second).GetChange() == nil {
		t.Fatal("expected change under .yaru when issues cannot be opened")
	}
}

func TestWatchUnknownWorkspace(t *testing.T) {
	built := newTestServer(t, Configuration{Ephemeral: true, WatchPoll: time.Hour, Heartbeat: time.Hour})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	client := yaruv1connect.NewWatchServiceClient(http.DefaultClient, running.URL())
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	stream, err := client.WatchWorkspace(ctx, connect.NewRequest(&v1.WatchWorkspaceRequest{Workspace: "missing"}))
	if err != nil {
		if connect.CodeOf(err) != connect.CodeNotFound || !containsNotFound(err) {
			t.Fatal(err)
		}
		return
	}
	if stream.Receive() {
		t.Fatal("missing workspace returned a message")
	}
	if connect.CodeOf(stream.Err()) != connect.CodeNotFound || !containsNotFound(stream.Err()) {
		t.Fatal(stream.Err())
	}
}

func TestWatchHeartbeat(t *testing.T) {
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	slug, _ := initWorkspace(t, stateDirectory, "heartbeat")
	built := newTestServer(t, Configuration{Ephemeral: true, WatchPoll: time.Hour, Heartbeat: 30 * time.Millisecond})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	if DefaultHeartbeat != 5*time.Second {
		t.Fatalf("default heartbeat: expected 5s, actual %s", DefaultHeartbeat)
	}
	client := yaruv1connect.NewWatchServiceClient(http.DefaultClient, running.URL())
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	stream, err := client.WatchWorkspace(ctx, connect.NewRequest(&v1.WatchWorkspaceRequest{Workspace: slug}))
	if err != nil {
		t.Fatal(err)
	}
	messages := readWatchMessages(stream)
	if readWatch(t, messages, 2*time.Second).GetReady() == nil {
		t.Fatal("expected ready")
	}
	if readWatch(t, messages, 2*time.Second).GetHeartbeat() == nil {
		t.Fatal("expected heartbeat")
	}
}

func readWatchMessages(stream *connect.ServerStreamForClient[v1.WatchWorkspaceResponse]) <-chan watchMessage {
	messages := make(chan watchMessage, 8)
	go func() {
		defer close(messages)
		for stream.Receive() {
			messages <- watchMessage{message: stream.Msg()}
		}
		if err := stream.Err(); err != nil && !errorsIsCanceled(err) {
			messages <- watchMessage{err: err}
		}
	}()
	return messages
}

func errorsIsCanceled(err error) bool {
	return err != nil && (connect.CodeOf(err) == connect.CodeCanceled || stringsContains(err.Error(), "context canceled"))
}

func stringsContains(text string, part string) bool {
	return indexOf(text, part) >= 0
}

func readWatch(t *testing.T, messages <-chan watchMessage, timeout time.Duration) *v1.WatchWorkspaceResponse {
	t.Helper()
	select {
	case event := <-messages:
		if event.err != nil {
			t.Fatal(event.err)
		}
		return event.message
	case <-time.After(timeout):
		t.Fatal("timed out waiting for a watch event")
	}
	return nil
}

func expectNoWatch(t *testing.T, messages <-chan watchMessage, timeout time.Duration) {
	t.Helper()
	select {
	case event := <-messages:
		if event.err != nil {
			t.Fatal(event.err)
		}
		t.Fatalf("unexpected watch event %#v", event.message.GetEvent())
	case <-time.After(timeout):
	}
}

func containsNotFound(err error) bool {
	return err != nil && (connect.CodeOf(err) == connect.CodeNotFound) && (len(err.Error()) > 0) && (stringContains(err.Error(), "workspace not found: missing"))
}

func stringContains(text string, part string) bool {
	return len(text) >= len(part) && (text == part || len(part) == 0 || (len(text) > 0 && (indexOf(text, part) >= 0)))
}

func indexOf(text string, part string) int {
	for index := 0; index+len(part) <= len(text); index++ {
		if text[index:index+len(part)] == part {
			return index
		}
	}
	return -1
}
