//! The main window opens at a fixed 1280x800 with a 960x640 floor. On a small or highly scaled
//! screen that is taller than the space above the taskbar, and the composer at the bottom ends up
//! off screen with no way to reach it. The one rule for the window is that it is usable the moment
//! the app starts, so it is fitted into the monitor's work area and centred there before it shows.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FittedWindow {
    pub min_width: u32,
    pub min_height: u32,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

/// Physical pixels throughout. `work` is (x, y, width, height) of the monitor's work area.
pub(crate) fn fit_into_work_area(
    work: (i32, i32, u32, u32),
    size: (u32, u32),
    min_size: (u32, u32),
) -> FittedWindow {
    let (work_x, work_y, work_width, work_height) = work;
    let width = size.0.min(work_width);
    let height = size.1.min(work_height);
    FittedWindow {
        // A floor larger than the work area would make the OS grow the window back past the edge.
        min_width: min_size.0.min(work_width),
        min_height: min_size.1.min(work_height),
        width,
        height,
        x: work_x + ((work_width - width) / 2) as i32,
        y: work_y + ((work_height - height) / 2) as i32,
    }
}

pub(crate) fn fit_main_window(window: &WebviewWindow, min_logical: (f64, f64)) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => match window.primary_monitor() {
            Ok(Some(monitor)) => monitor,
            _ => return,
        },
    };
    let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) else {
        return;
    };
    // The work area holds the outer frame, but the size setters take the inner size. Fit the outer
    // size and take the frame off again, or every launch would grow the window by one frame.
    let frame = (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let fitted = fit_into_work_area(
        (
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        ),
        (outer.width, outer.height),
        (
            (min_logical.0 * scale).round() as u32 + frame.0,
            (min_logical.1 * scale).round() as u32 + frame.1,
        ),
    );
    let _ = window.set_min_size(Some(PhysicalSize::new(
        fitted.min_width.saturating_sub(frame.0),
        fitted.min_height.saturating_sub(frame.1),
    )));
    let _ = window.set_size(PhysicalSize::new(
        fitted.width.saturating_sub(frame.0),
        fitted.height.saturating_sub(frame.1),
    ));
    let _ = window.set_position(PhysicalPosition::new(fitted.x, fitted.y));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_that_fits_keeps_its_size_and_is_centred() {
        let fitted = fit_into_work_area((0, 0, 1920, 1040), (1280, 800), (960, 640));
        assert_eq!((fitted.width, fitted.height), (1280, 800));
        assert_eq!((fitted.x, fitted.y), (320, 120));
        assert_eq!((fitted.min_width, fitted.min_height), (960, 640));
    }

    #[test]
    fn a_small_screen_shrinks_the_window_and_its_floor_so_the_bottom_stays_reachable() {
        // 1366x768 at 125%: about 1093x582 logical above the taskbar, 1366x728 physical.
        let fitted = fit_into_work_area((0, 0, 1366, 728), (1600, 1000), (1200, 800));
        assert_eq!((fitted.width, fitted.height), (1366, 728));
        assert_eq!((fitted.min_width, fitted.min_height), (1200, 728));
        assert_eq!((fitted.x, fitted.y), (0, 0));
    }

    #[test]
    fn a_monitor_left_of_the_primary_keeps_its_negative_origin() {
        let fitted = fit_into_work_area((-1920, 0, 1920, 1040), (1280, 800), (960, 640));
        assert_eq!((fitted.x, fitted.y), (-1600, 120));
    }
}
