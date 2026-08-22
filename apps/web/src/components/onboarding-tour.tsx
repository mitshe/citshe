"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

const TOUR_COMPLETED_KEY = "onboarding-tour-completed";

const tourSteps: DriveStep[] = [
  {
    popover: {
      title: "Welcome to citshe!",
      description:
        "Manage all your portals from one place — right from your phone. Each portal is its own space. Quick tour!",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "[data-tour='nav-home']",
    popover: {
      title: "Home",
      description:
        "Your home screen. Pick a portal, tell the AI what to do, and watch progress live.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='nav-tasks']",
    popover: {
      title: "Tasks",
      description:
        "All tasks for this portal. Write a rough note, let AI shape it, then a worker runs it in an isolated container and pushes to your repo.",
      side: "right",
      align: "start",
    },
  },
];

export function OnboardingTour() {
  const pathname = usePathname();
  const [shouldShowTour, setShouldShowTour] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "true";
    setShouldShowTour(!completed);
  }, []);

  useEffect(() => {
    if (pathname !== "/home") return;
    if (!shouldShowTour) return;

    const timer = setTimeout(() => {
      // The tour anchors to sidebar nav items that are `hidden md:flex`.
      // On phones those targets don't exist, so skip the tour entirely.
      if (!window.matchMedia("(min-width: 768px)").matches) return;

      const driverObj = driver({
        showProgress: true,
        showButtons: ["next", "previous", "close"],
        steps: tourSteps,
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        progressText: "{{current}} of {{total}}",
        popoverClass: "onboarding-popover",
        // A touch of breathing room around the highlighted nav item + smooth
        // motion so the spotlight reads as intentional, not a raw box.
        stagePadding: 6,
        stageRadius: 8,
        overlayOpacity: 0.72,
        smoothScroll: true,
        animate: true,
        onDestroyed: () => {
          localStorage.setItem(TOUR_COMPLETED_KEY, "true");
          setShouldShowTour(false);
        },
      });

      driverObj.drive();
    }, 800);

    return () => clearTimeout(timer);
  }, [shouldShowTour, pathname]);

  return null;
}

export function resetOnboardingTour() {
  localStorage.removeItem(TOUR_COMPLETED_KEY);
}
