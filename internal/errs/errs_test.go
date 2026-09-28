package errs

import (
	"errors"
	"testing"
)

func TestWrapKeepsTheMessageAndTheKind(t *testing.T) {
	err := Wrap("comment not found: 1", ErrNotFound)
	if err.Error() != "comment not found: 1" {
		t.Fatalf("message: %q", err.Error())
	}
	if !errors.Is(err, ErrNotFound) {
		t.Fatal("expected ErrNotFound")
	}
	if errors.Is(err, ErrInvalidArgument) || errors.Is(err, ErrConflict) {
		t.Fatal("wrong kind")
	}
}

func TestKindsAreDistinct(t *testing.T) {
	invalid := Wrap("invalid priority: expected low, actual no", ErrInvalidArgument)
	conflict := Wrap("cannot answer question 1: expected status open, actual answered", ErrConflict)
	if !errors.Is(invalid, ErrInvalidArgument) || errors.Is(invalid, ErrConflict) {
		t.Fatal("invalid argument")
	}
	if !errors.Is(conflict, ErrConflict) || conflict.Error() != "cannot answer question 1: expected status open, actual answered" {
		t.Fatalf("conflict: %v", conflict)
	}
}
