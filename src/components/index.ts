// Aggregator for the builder helper modules.
// Covers Radix-based components (Dialog, Tabs, Sheet, etc.) and non-Radix
// patterns (Ticker, Carousel, Bento, Swiper) — each helper builds the
// nesting structure required by Webstudio.

export { addDialog } from "./dialog.js";
export type { DialogOptions, DialogResult } from "./dialog.js";

export { addTabs } from "./tabs.js";
export type { TabsOptions, TabsResult } from "./tabs.js";

export { addTooltip, addSwitch, addCheckbox } from "./forms.js";
export type {
  TooltipOptions, TooltipResult,
  SwitchOptions, SwitchResult,
  CheckboxOptions, CheckboxResult,
} from "./forms.js";

export { addNavigationMenu } from "./navigation-menu.js";
export type { NavItem, NavigationMenuOptions, NavigationMenuResult } from "./navigation-menu.js";

export { addAccordion } from "./details.js";
export type { AccordionItem, AccordionOptions, AccordionResult } from "./details.js";

export { addCard } from "./cards.js";
export type { CardOptions, CardResult } from "./cards.js";

export { addSheet } from "./sheet.js";
export type { SheetLink, SheetOptions, SheetResult } from "./sheet.js";

export { sheetAnimationCss } from "./animations.js";

export { addTicker, buildTickerHtml } from "./ticker.js";
export type { TickerItem, TickerOptions, TickerResult } from "./ticker.js";

export { addBento } from "./bento.js";
export type { BentoItem, BentoOptions, BentoResult } from "./bento.js";

export { addCarousel, carouselScript } from "./carousel.js";
export type { CarouselSlide, CarouselOptions, CarouselResult } from "./carousel.js";

export { addSwiper, buildSwiperEmbedHtml } from "./swiper.js";
export type { SwiperSlide, SwiperConfig, SwiperOptions, SwiperResult } from "./swiper.js";

export { addVideoBackground } from "./video-background.js";
export type { VideoBackgroundOptions, VideoBackgroundResult } from "./video-background.js";
