import XCTest

/// Return on a text field is "done": the keyboard goes away, and a field that sends, sends.
final class ReturnKeyTests: XCTestCase {
    func testTypingIsKeptAsTyped() {
        let edit = ReturnKey.edit(from: "I clim", to: "I climb")
        XCTAssertEqual(edit.text, "I climb")
        XCTAssertFalse(edit.returned)
    }

    func testReturnAtTheEndIsDoneAndLeavesNoNewline() {
        let edit = ReturnKey.edit(from: "I climb the wall", to: "I climb the wall\n")
        XCTAssertEqual(edit.text, "I climb the wall")
        XCTAssertTrue(edit.returned)
    }

    func testReturnInTheMiddleIsDoneToo() {
        let edit = ReturnKey.edit(from: "I climb the wall", to: "I climb\n the wall")
        XCTAssertEqual(edit.text, "I climb the wall")
        XCTAssertTrue(edit.returned)
    }

    func testReturnOnAnEmptyFieldIsDoneWithNothingInIt() {
        let edit = ReturnKey.edit(from: "", to: "\n")
        XCTAssertEqual(edit.text, "")
        XCTAssertTrue(edit.returned)
    }

    func testPastedLinesBecomeOneLineAndDoNotSend() {
        let edit = ReturnKey.edit(from: "Note: ", to: "Note: first line\nsecond line")
        XCTAssertEqual(edit.text, "Note: first line second line")
        XCTAssertFalse(edit.returned)
    }

    func testDeletingIsKeptAsTyped() {
        let edit = ReturnKey.edit(from: "I climb\n", to: "I climb")
        XCTAssertEqual(edit.text, "I climb")
        XCTAssertFalse(edit.returned)
    }
}
