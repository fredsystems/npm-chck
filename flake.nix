{
  # This example flake.nix is pretty generic and the same for all
  # examples, except when they define devShells or extra packages.
  description = "Dev Flake";

  # We import the latest commit of dream2nix main branch and instruct nix to
  # reuse the nixpkgs revision referenced by dream2nix.
  # This is what we test in CI with, but you can generally refer to any
  # recent nixpkgs commit here.
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
      # A helper that helps us define the attributes below for
      # all systems we care about.
      eachSystem = nixpkgs.lib.genAttrs [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
    in
    {
      checks = eachSystem (system: {
        pre-commit-check = precommit-base.lib.mkCheck {
          inherit system;

          src = ./.;

          check_javascript = true;
          check_python = false;

          # javascript = {
          #   enableBiome = true;
          #   enableTsc = true;
          #   tsConfig = "./tsconfig.json";
          # };

          extraExcludes = [
            "secrets.yaml"
            "Logo-Sources"
            ".*.mp3"
          ];
        };
      });

      # packages = eachSystem (system: {
      #   # For each system, we define our default package
      #   # by passing in our desired nixpkgs revision plus
      #   # any dream2nix modules needed by it.
      #   dream2nix.lib.evalModules {
      #     packageSets.nixpkgs = nixpkgs.legacyPackages.${system};
      #     modules = [
      #       # Import our actual package definition as a dream2nix module from ./default.nix
      #       ./default.nix
      #       {
      #         # Aid dream2nix to find the project root. This setup should also works for mono
      #         # repos. If you only have a single project, the defaults should be good enough.
      #         paths.projectRoot = ./.;
      #         # can be changed to ".git" or "flake.nix" to get rid of .project-root
      #         paths.projectRootFile = "flake.nix";
      #         paths.package = ./.;
      #       }
      #     ];
      #   };
      # );
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
              pkgs.npm-check
              pkgs.nodejs
              pkgs.just
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
