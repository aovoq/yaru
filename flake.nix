{
  description = "yaru の開発環境 (Go 移行の間は Bun と Go の両方)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            go
            gopls
            golangci-lint
            buf
            protoc-gen-go
            protoc-gen-connect-go
          ];
          # declscope は nixpkgs に無いので、リポジトリの中の .bin に固定の版を go install する (make go-tools)
          shellHook = ''
            export GOBIN="$PWD/.bin"
            export PATH="$GOBIN:$PATH"
          '';
        };
      });
    };
}
