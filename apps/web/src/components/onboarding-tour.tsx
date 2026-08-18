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
    element: "[data-tour='nav-chat']",
    popover: {
      title: "Chat",
      description:
        "Talk to your assistant — ask, plan, delegate. Chat history lives in its own panel.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='nav-tasks']",
    popover: {
      title: "Tasks",
      description:
        "All tasks for this portal. Each one can be run by AI in an isolated container and pushed to your repo.",
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
      const driverObj = driver({
        showProgress: true,
        showButtons: ["next", "previous", "close"],
        steps: tourSteps,
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        progressText: "{{current}} of {{total}}",
        popoverClass: "onboarding-popover",
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
