# A cask for a personal tap (github.com/sue738/homebrew-tap, Casks/):
#
#   brew install --cask sue738/tap/rally
#
# Per release: bump `version` and both sha256 (from app/release.sh's SHA256SUMS).
# Not notarized, so postflight clears the quarantine for Gatekeeper.
cask "rally" do
  arch arm: "arm64", intel: "x86_64"

  version "0.0.1"
  sha256 arm:   "9880c92d9228a8020424b3bd35d4c92418d0f27b9a22814f92257dcc90a9fb54",
         intel: "2ce06aadc6f8aa4755e41d5240e17562d0c53ae5a489c1d8062884a9545393fc"

  url "https://github.com/sue738/rally/releases/download/v#{version}/Rally-#{version}-#{arch}.dmg"
  name "Rally"
  desc "One list of every coding-agent session on the Mac, and a place to answer them"
  homepage "https://github.com/sue738/rally"

  depends_on macos: :sonoma

  app "Rally.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/Rally.app"]
  end

  # current and legacy names
  names = [
    "rally", # rename:keep
    "hotaru",
    "ika",
    "agentkanban",
  ]
  zap trash: names.flat_map { |n|
    ["~/.#{n}", "~/Library/Preferences/dev.sue738.#{n}.plist", "~/Library/WebKit/dev.sue738.#{n}"]
  }
end
