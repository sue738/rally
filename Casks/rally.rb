# A cask for a personal tap (github.com/sue738/homebrew-tap, Casks/):
#
#   brew install --cask sue738/tap/rally
#
# Per release: bump `version` and both sha256 (from app/release.sh's SHA256SUMS).
# Not notarized, so postflight clears the quarantine for Gatekeeper.
cask "rally" do
  arch arm: "arm64", intel: "x86_64"

  version "0.0.3"
  sha256 arm:   "3385858eb937bd222f07c7d67589fa98a99b3941e9777b9f656407d275a6bc53",
         intel: "2355f8871dae439b5950e6785294c943ddbdfc91cd5b27cc1b8e3a7da8badab5"

  url "https://github.com/sue738/rally/releases/download/v#{version}/Rally-#{version}-#{arch}.dmg"
  name "Rally"
  desc "One list of every coding-agent session on the Mac, and a place to answer them"
  homepage "https://github.com/sue738/rally"

  depends_on macos: :sonoma

  app "Rally.app"

  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Rally.app"]
  end

  zap trash: ["~/.rally", "~/Library/Preferences/dev.sue738.rally.plist", "~/Library/WebKit/dev.sue738.rally"]
end
