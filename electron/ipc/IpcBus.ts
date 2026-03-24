const { ipcMain } = require('electron');
import type { IpcMainInvokeEvent } from 'electron';
import { Logger } from '../utils/Logger';

type Handler<T = unknown> = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T>;

/**
 * Type-safe IPC bus that auto-wraps handlers with error catching + logging.
 */
export class IpcBus {
  private logger = Logger.create('IpcBus');
  private handlers = new Map<string, Handler>();

  /**
   * Register a handler for an IPC channel.
   * Auto-wraps with try/catch and structured error response.
   */
  handle<T>(channel: string, handler: Handler<T>): void {
    if (this.handlers.has(channel)) {
      this.logger.warn(`Overwriting handler for channel: ${channel}`);
      ipcMain.removeHandler(channel);
    }

    const wrappedHandler = async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`IPC handler error [${channel}]: ${message}`);
        return { __ipcError: true, message, channel };
      }
    };

    ipcMain.handle(channel, wrappedHandler);
    this.handlers.set(channel, wrappedHandler as Handler);
    this.logger.debug(`Registered handler: ${channel}`);
  }

  /**
   * Register a one-way listener (ipcMain.on).
   */
  on(channel: string, listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void): void {
    ipcMain.on(channel, listener);
  }

  /**
   * Remove all registered handlers.
   */
  dispose(): void {
    for (const channel of this.handlers.keys()) {
      ipcMain.removeHandler(channel);
    }
    this.handlers.clear();
    this.logger.info('All IPC handlers disposed');
  }
}
