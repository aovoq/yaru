{
  description = "yaru の開発環境と、Go 版の実行ファイル";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
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

      # 画面を npm で作り、Go が web/dist を埋め込んだ実行ファイルを 1 つ出す (web/embed.go)
      packages = forAll (
        pkgs:
        let
          # 画面の成果物。Go の埋め込みは、この dist をソースの web/dist に置いてからコンパイルする
          webDist = pkgs.buildNpmPackage {
            pname = "yaru-web";
            version = "0.0.0";
            src = ./web;
            npmDepsHash = "sha256-014RujSEm9mniwtF2gqgHMeEQxDpaYAyRjkCkxx2EHI=";
            # npm pack は gitignore された dist を落とすので、Vite の dist をそのまま出す
            dontNpmInstall = true;
            # Vite は web の親の assets/fonts/InterVariable.woff2 を dist にコピーする (web/vite.config.ts)
            preBuild = ''
              fontDirectory="$(dirname "$PWD")/assets/fonts"
              mkdir -p "$fontDirectory"
              cp ${./assets/fonts/InterVariable.woff2} "$fontDirectory/InterVariable.woff2"
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R dist "$out/dist"
              runHook postInstall
            '';
          };
        in
        {
          default = pkgs.buildGoModule {
            pname = "yaru";
            version = "0.0.0";
            src = ./.;
            vendorHash = "sha256-6Wwtsks2MrDNIsRL/g/XWMPXWb4ewzhtBQ97j5r9cpU=";
            subPackages = [ "cmd/yaru" ];
            # パッケージのビルドでは go test を回さない。git が要るテストと、golden は外で確かめる
            doCheck = false;
            meta.mainProgram = "yaru";
            preBuild = ''
              rm -rf web/dist
              mkdir -p web/dist
              cp -R ${webDist}/dist/. web/dist/
            '';
          };
        }
      );
    };
}
