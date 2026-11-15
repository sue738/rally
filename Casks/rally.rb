# A cask for a personal tap (github.com/sue738/homebrew-tap, Casks/):
#
#   brew install --cask sue738/tap/rally
#
# Per release: bump `version` and both sha256 (from app/release.sh's SHA256SUMS).
# Not notarized, so postflight clears the quarantine for Gatekeeper.
cask "rally" do
  arch arm: "arm64", intel: "x86_64"

  version "0.0.8"
  sha256 arm:   "439a033e40cb1562cba83e58582c4266e1306c6a1d226bd118ab0bf912d67212",
         intel: "6d4c1d5735fdde6a8b53d2595d18830422bd12b5ea98b8663990890a4d915b60"

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
