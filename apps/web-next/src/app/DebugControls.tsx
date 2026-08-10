'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import ThemeButton from './ThemeButton';
import styles from './ThemeButton.module.sass';

const CloseControlsContext = createContext<(() => void) | null>(null);

export const useCloseDebugControls = () => useContext(CloseControlsContext);

export function DebugControls({
  children,
  toolbarControls,
}: {
  children: ReactNode;
  toolbarControls?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={styles.toolbar}>
        {toolbarControls}
        <ThemeButton
          contained
          controlsId="prototype-controls-drawer"
          controlsOpen={open}
          onLongPress={() => setOpen((current) => !current)}
        />
      </div>
      <div
        className={styles.controlsDrawer}
        id="prototype-controls-drawer"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
        data-toolbar-controls={toolbarControls ? true : undefined}
      >
        <CloseControlsContext.Provider value={() => setOpen(false)}>
          {children}
        </CloseControlsContext.Provider>
      </div>
    </>
  );
}
