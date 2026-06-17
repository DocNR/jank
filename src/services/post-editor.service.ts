class PostEditorService extends EventTarget {
  static instance: PostEditorService

  isSuggestionPopupOpen = false

  // Number of composer dialogs/sheets currently open across the whole app.
  // Reply composers live INSIDE virtualized NoteCard rows, so anything that
  // re-lays out or scrolls a feed (e.g. NoteList auto-prepending a live
  // arrival + scrollToTop) can unmount the owning row and close the dialog out
  // from under the user. Feeds read `isAnyOpen` to hold the timeline steady
  // while a composer is open, buffering arrivals into the "new notes" pill
  // instead. Refcounted because multiple composers can be mounted at once
  // (per-column reply buttons, top-level compose, quote-repost).
  private openCount = 0

  constructor() {
    super()
    if (!PostEditorService.instance) {
      PostEditorService.instance = this
    }
    return PostEditorService.instance
  }

  get isAnyOpen() {
    return this.openCount > 0
  }

  registerOpen() {
    this.openCount += 1
    // Only the closed -> open boundary changes what consumers see.
    if (this.openCount === 1) {
      this.dispatchEvent(new CustomEvent('openStateChange'))
    }
  }

  unregisterOpen() {
    if (this.openCount === 0) return
    this.openCount -= 1
    if (this.openCount === 0) {
      this.dispatchEvent(new CustomEvent('openStateChange'))
    }
  }

  closeSuggestionPopup() {
    if (this.isSuggestionPopupOpen) {
      this.isSuggestionPopupOpen = false
      this.dispatchEvent(new CustomEvent('closeSuggestionPopup'))
    }
  }
}

const instance = new PostEditorService()
export default instance
