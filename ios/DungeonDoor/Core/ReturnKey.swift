/// The Return key on a field players type into (docs/app-tabs.md). A multi-line field gets Return as a
/// newline typed into its text; the app takes it as "done" instead: the newline is dropped, the field
/// submits (where it has something to submit) and the keyboard goes away.
enum ReturnKey {
    /// An edit of a field's text, from `old` to `new`: the text to keep, and whether it was Return.
    /// Return types one newline and nothing else; lines pasted in are joined with spaces and send nothing.
    static func edit(from old: String, to new: String) -> (text: String, returned: Bool) {
        guard new.contains(where: \.isNewline) else { return (new, false) }
        if new.count == old.count + 1 {
            let kept = new.filter { !$0.isNewline }
            if kept.count == old.count { return (kept, true) }
        }
        return (new.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).joined(separator: " "), false)
    }
}
