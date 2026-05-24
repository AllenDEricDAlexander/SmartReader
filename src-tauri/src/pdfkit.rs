use std::path::PathBuf;

use crate::{PdfRasterPageDto, PdfRasterPageRequest};

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ffi::c_void,
        fs,
        io::Cursor,
        path::{Path, PathBuf},
    };

    use objc2::{rc::autoreleasepool, AnyThread};
    use objc2_core_foundation::{CGFloat, CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        CGBitmapContextCreate, CGColorSpace, CGContext, CGImageAlphaInfo, CGImageByteOrderInfo,
    };
    use objc2_foundation::{NSString, NSURL};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};

    use crate::{
        PdfRasterOutputKind, PdfRasterPageDto, PdfRasterPageRequest, ENCRYPTED_DOCUMENT_ERROR,
    };

    const DEFAULT_SCALE: f64 = 1.0;
    const MIN_SCALE: f64 = 0.1;
    const MAX_SCALE: f64 = 4.0;
    const DEFAULT_MAX_PIXELS: u64 = 16_000_000;
    const ABSOLUTE_MAX_PIXELS: u64 = 32_000_000;

    pub(crate) fn render_pdf_page_pdfkit_from_path(
        document_path: PathBuf,
        request: PdfRasterPageRequest,
    ) -> Result<PdfRasterPageDto, String> {
        autoreleasepool(|_| render_pdf_page_pdfkit_inner(&document_path, request))
    }

    fn render_pdf_page_pdfkit_inner(
        document_path: &Path,
        request: PdfRasterPageRequest,
    ) -> Result<PdfRasterPageDto, String> {
        let page_number = request.page;
        if page_number == 0 {
            return Err("Invalid PDF page".to_string());
        }

        let scale = bounded_scale(request.scale)?;
        let document_path_string = document_path.to_string_lossy().into_owned();
        let ns_path = NSString::from_str(&document_path_string);
        let url = NSURL::fileURLWithPath(&ns_path);

        let document = unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }
            .ok_or_else(|| "PDFKit could not open this PDF document.".to_string())?;
        if unsafe { document.isEncrypted() } || unsafe { document.isLocked() } {
            return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
        }

        let page_count = unsafe { document.pageCount() } as usize;
        if page_number > page_count {
            return Err("Invalid PDF page".to_string());
        }

        let page = unsafe { document.pageAtIndex(page_number - 1) }
            .ok_or_else(|| "Invalid PDF page".to_string())?;
        let bounds = unsafe { page.boundsForBox(PDFDisplayBox::MediaBox) };
        let width = scaled_dimension(bounds.size.width, scale)?;
        let height = scaled_dimension(bounds.size.height, scale)?;
        let pixel_count = u64::from(width) * u64::from(height);
        let max_pixels = request
            .max_pixels
            .unwrap_or(DEFAULT_MAX_PIXELS)
            .min(ABSOLUTE_MAX_PIXELS);
        if pixel_count > max_pixels {
            return Err("PDFKit raster output is too large.".to_string());
        }

        let bytes_per_row = usize::try_from(width)
            .ok()
            .and_then(|width| width.checked_mul(4))
            .ok_or_else(|| "PDFKit raster output is too large.".to_string())?;
        let buffer_len = bytes_per_row
            .checked_mul(height as usize)
            .ok_or_else(|| "PDFKit raster output is too large.".to_string())?;
        let mut pixels = vec![255u8; buffer_len];
        draw_pdf_page(
            &page,
            bounds,
            width,
            height,
            scale,
            bytes_per_row,
            &mut pixels,
        )?;
        let png_bytes = encode_png(width, height, &pixels)?;
        let byte_count = png_bytes.len();
        let output = request.output.unwrap_or(PdfRasterOutputKind::Bytes);
        let temp_path = if output == PdfRasterOutputKind::TempFile {
            let path = write_temp_png(&png_bytes)?;
            Some(path.to_string_lossy().into_owned())
        } else {
            None
        };
        let bytes = if output == PdfRasterOutputKind::Bytes {
            Some(png_bytes)
        } else {
            None
        };

        Ok(PdfRasterPageDto {
            supported: true,
            status: "rendered".to_string(),
            path: document_path_string,
            page: page_number,
            width,
            height,
            scale,
            mime_type: Some("image/png".to_string()),
            byte_count,
            bytes,
            temp_path,
        })
    }

    fn bounded_scale(scale: Option<f64>) -> Result<f64, String> {
        let scale = scale.unwrap_or(DEFAULT_SCALE);
        if !scale.is_finite() || scale <= 0.0 {
            return Err("Invalid PDFKit raster scale.".to_string());
        }

        Ok(scale.clamp(MIN_SCALE, MAX_SCALE))
    }

    fn scaled_dimension(points: CGFloat, scale: f64) -> Result<u32, String> {
        let pixels = (points.abs() * scale).ceil();
        if !pixels.is_finite() || pixels <= 0.0 || pixels > u32::MAX as CGFloat {
            return Err("Invalid PDF page size.".to_string());
        }

        Ok(pixels as u32)
    }

    fn draw_pdf_page(
        page: &objc2_pdf_kit::PDFPage,
        bounds: CGRect,
        width: u32,
        height: u32,
        scale: f64,
        bytes_per_row: usize,
        pixels: &mut [u8],
    ) -> Result<(), String> {
        let color_space = CGColorSpace::new_device_rgb()
            .ok_or_else(|| "PDFKit could not create a raster color space.".to_string())?;
        let bitmap_info =
            CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0;
        let context = unsafe {
            CGBitmapContextCreate(
                pixels.as_mut_ptr().cast::<c_void>(),
                width as usize,
                height as usize,
                8,
                bytes_per_row,
                Some(&color_space),
                bitmap_info,
            )
        }
        .ok_or_else(|| "PDFKit could not create a raster context.".to_string())?;
        let width = width as CGFloat;
        let height = height as CGFloat;
        let scale = scale as CGFloat;

        CGContext::set_rgb_fill_color(Some(&context), 1.0, 1.0, 1.0, 1.0);
        CGContext::fill_rect(
            Some(&context),
            CGRect::new(CGPoint::ZERO, CGSize::new(width, height)),
        );
        CGContext::save_g_state(Some(&context));
        CGContext::translate_ctm(Some(&context), 0.0, height);
        CGContext::scale_ctm(Some(&context), scale, -scale);
        CGContext::translate_ctm(Some(&context), -bounds.origin.x, -bounds.origin.y);
        unsafe {
            page.drawWithBox_toContext(PDFDisplayBox::MediaBox, &context);
        }
        CGContext::restore_g_state(Some(&context));

        Ok(())
    }

    fn encode_png(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(Cursor::new(&mut bytes), width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|_| "PDFKit could not encode raster output.".to_string())?;
            writer
                .write_image_data(pixels)
                .map_err(|_| "PDFKit could not encode raster output.".to_string())?;
        }

        Ok(bytes)
    }

    fn write_temp_png(bytes: &[u8]) -> Result<PathBuf, String> {
        let path = std::env::temp_dir().join(format!(
            "smartreader-pdfkit-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default()
        ));
        fs::write(&path, bytes).map_err(|_| "PDFKit could not write raster output.".to_string())?;

        Ok(path)
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::PathBuf;

    use crate::{PdfRasterPageDto, PdfRasterPageRequest};

    pub(crate) fn render_pdf_page_pdfkit_from_path(
        document_path: PathBuf,
        request: PdfRasterPageRequest,
    ) -> Result<PdfRasterPageDto, String> {
        Ok(PdfRasterPageDto {
            supported: false,
            status: "unsupported-platform".to_string(),
            path: document_path.to_string_lossy().into_owned(),
            page: request.page,
            width: 0,
            height: 0,
            scale: request.scale.unwrap_or(1.0),
            mime_type: None,
            byte_count: 0,
            bytes: None,
            temp_path: None,
        })
    }
}

pub(crate) fn render_pdf_page_pdfkit_from_path(
    document_path: PathBuf,
    request: PdfRasterPageRequest,
) -> Result<PdfRasterPageDto, String> {
    platform::render_pdf_page_pdfkit_from_path(document_path, request)
}
