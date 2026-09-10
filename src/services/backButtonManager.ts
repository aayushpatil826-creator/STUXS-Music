/**
 * BackButtonManager
 * Centralized LIFO modal & sheet stack manager for Android hardware/system Back gestures.
 * Ensures that all modal dialogs, bottom sheets, and the fullscreen player execute their
 * smooth animated dismiss transitions on Back button press.
 */

interface ModalEntry {
  id: string;
  dismissFn: () => void;
  priority: number;
}

class BackButtonManager {
  private stack: ModalEntry[] = [];

  /**
   * Registers a modal / sheet / view on the active back stack.
   */
  public register(id: string, dismissFn: () => void, priority = 10): () => void {
    // Remove any existing entry with same id
    this.stack = this.stack.filter((m) => m.id !== id);
    this.stack.push({ id, dismissFn, priority });
    // Sort by priority ascending (highest priority executed first at top of stack)
    this.stack.sort((a, b) => a.priority - b.priority);

    return () => {
      this.unregister(id);
    };
  }

  /**
   * Unregisters a modal from the back stack.
   */
  public unregister(id: string): void {
    this.stack = this.stack.filter((m) => m.id !== id);
  }

  /**
   * Handles the back gesture by executing the top-most modal's animated dismiss handler.
   * Returns true if a modal was dismissed, false if no modals are currently open.
   */
  public handleBack(): boolean {
    if (this.stack.length === 0) return false;

    // Pop the top-most active modal
    const top = this.stack.pop();
    if (top && typeof top.dismissFn === 'function') {
      try {
        top.dismissFn();
      } catch (err) {
        console.warn('[BackButtonManager] Error executing dismiss for:', top.id, err);
      }
      return true;
    }

    return false;
  }

  public hasActiveModals(): boolean {
    return this.stack.length > 0;
  }
}

export const backButtonManager = new BackButtonManager();
