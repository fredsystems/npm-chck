{
  description = "npm-chck - Check for outdated, incorrect, and unused dependencies.";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    precommit-base = {
      url = "github:FredSystems/pre-commit-checks";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      precommit-base,
      nixpkgs,
    }:
    let
      eachSystem = nixpkgs.lib.genAttrs [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
    in
    {
      packages = eachSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          npm-chck = pkgs.buildNpmPackage {
            pname = "npm-chck";
            version = "7.0.0";

            src = ./.;

            npmDepsHash = "sha256-H2ArXqjZvjJsrICxd9zwC4l9IBKvq94VArkFk84RKyU=";

            # No build step needed for this package
            npmBuildScript = "prepare";

            meta = with pkgs.lib; {
              description = "Check for outdated, incorrect, and unused dependencies.";
              homepage = "https://github.com/FredSystems/npm-chck";
              license = licenses.mit;
              maintainers = [ ];
              mainProgram = "npm-chck";
            };
          };

          default = self.packages.${system}.npm-chck;
        }
      );

      checks = eachSystem (system: {
        pre-commit-check = precommit-base.lib.mkCheck {
          inherit system;

          src = ./.;

          check_javascript = true;
          check_python = false;

          extraExcludes = [
            "secrets.yaml"
            "Logo-Sources"
            ".*.mp3"
          ];
        };
      });

      devShells = eachSystem (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
          };

          inherit (self.checks.${system}.pre-commit-check) shellHook enabledPackages;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs
            ];

            buildInputs =
              enabledPackages
              ++ (with pkgs; [
                nodejs
                nodePackages.typescript
              ]);

            shellHook = ''
              ${shellHook}
            '';
          };
        }
      );
    };
}
