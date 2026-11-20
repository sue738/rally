# A cask for a personal tap (github.com/sue738/homebrew-tap, Casks/):
#
#   brew install --cask sue738/tap/rally
#
# Per release: bump `version` and both sha256 (from app/release.sh's SHA256SUMS).
# Not notarized, so postflight clears the quarantine for Gatekeeper.
cask "rally" do
  arch arm: "arm64", intel: "x86_64"

  version "0.0.12"
  sha256 arm:   "c1cd609be41134e018b3ead986be3955f09f57e1d11bee154fc7c7366878d63f",
         intel: "cc092db05b20301104670ab1a0eacf5a21e2f1b5d17ddf9c791528e0225ccc20"

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
