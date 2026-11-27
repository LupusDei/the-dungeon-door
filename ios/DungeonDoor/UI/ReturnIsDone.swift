import SwiftUI
import UIKit

/// Return on a field players type into is "done" (Core/ReturnKey.swift): the keyboard goes away and the
/// field's `action`, if it has one, runs: send, speak, join. A multi-line field gets Return as a newline;
/// that newline is dropped instead of kept. A single-line field gets it as a submit.
private struct ReturnIsDone: ViewModifier {
    @Binding var text: String
    let label: SubmitLabel
    let action: (() -> Void)?

    func body(content: Content) -> some View {
        content
            .submitLabel(label)
            .onSubmit(done)
            .onChange(of: text) { old, new in
                let edit = ReturnKey.edit(from: old, to: new)
                if edit.text != new { text = edit.text }
                if edit.returned { done() }
            }
    }

    private func done() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        action?()
    }
}

extension View {
    /// Return hides the keyboard, and runs `action` (send, speak, join) when the field has one.
    func returnIsDone(_ text: Binding<String>, label: SubmitLabel = .done, action: (() -> Void)? = nil) -> some View {
        modifier(ReturnIsDone(text: text, label: label, action: action))
    }
}
