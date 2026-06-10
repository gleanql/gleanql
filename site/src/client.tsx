import { initClient, initClientNavigation } from "rwsdk/client";

// RSC client navigation: sidebar links swap the page via the flight stream
// instead of full document loads. https://docs.rwsdk.com/guides/frontend/client-side-nav/
const { handleResponse, onHydrated } = initClientNavigation();
initClient({ handleResponse, onHydrated });
