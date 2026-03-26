// Mock for virtual:pwa-register/react (Vite PWA plugin virtual module)
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: () => {},
  };
}
