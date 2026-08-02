/**
 * The two things about the device that more than one feature has to know.
 *
 * Both started life in push.ts, because Apple's Home Screen rule was the first
 * thing that needed them. The mini player needs the same answer for an entirely
 * unrelated reason — iPadOS will not put a canvas stream into a floating window
 * — and a component about picture-in-picture importing from a module about
 * notifications would be a lie about why the two are related. They are not:
 * they both just need to know what they are running on.
 */

/**
 * An iPhone or iPad, including the ones that deny it.
 *
 * iPadOS 13 and later report themselves as a Mac — same platform string, same
 * user agent — so the only thing separating an iPad from a MacBook is that one
 * of them has a touchscreen. Hence the maxTouchPoints half; it is not a
 * flourish, it is the whole test on an iPad.
 */
export const isApplePortable =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** Already launched from the Home Screen rather than sitting in a browser tab. */
export const isStandalone =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true)
