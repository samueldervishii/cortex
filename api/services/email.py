"""Outbound email helpers.

Email is intentionally optional: when SMTP isn't configured we fall back
to logging the would-be message. That keeps dev/test flows usable
without a real mail server, and means production without SMTP fails
*loudly via logs* instead of crashing the app on every signup.

Only the password-reset flow uses this today, but the helper is
generic enough to grow more callers (verification, notification, etc.)
without changing shape.
"""

from __future__ import annotations

import logging
from email.message import EmailMessage
from typing import Optional

from config import settings

logger = logging.getLogger("etude.email")


def is_configured() -> bool:
    """Return True when SMTP is configured well enough to attempt a send."""
    return bool(
        settings.smtp_host
        and settings.smtp_from_email
    )


async def send_email(
    to_address: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
) -> bool:
    """Send a single transactional email.

    Returns True on a successful SMTP delivery, False otherwise.
    Failures are logged but never raised — callers (e.g. the
    forgot-password endpoint) intentionally swallow errors so we don't
    leak whether an account exists via differential error responses.
    """
    if not is_configured():
        # Dev/test fallback: log the link so the developer can copy it
        # out of stderr instead of needing a real SMTP server.
        logger.warning(
            "SMTP not configured; would have sent email\nto=%s\nsubject=%s\nbody=\n%s",
            to_address,
            subject,
            text_body,
        )
        return False

    try:
        # aiosmtplib is imported lazily so the dependency stays optional
        # for installs that don't need email.
        import aiosmtplib  # type: ignore
    except ImportError:
        logger.error(
            "aiosmtplib is not installed but SMTP is configured. "
            "Install it with: pip install 'aiosmtplib>=3.0.0'"
        )
        return False

    message = EmailMessage()
    from_label = settings.smtp_from_name or "Étude"
    message["From"] = f"{from_label} <{settings.smtp_from_email}>"
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            # ``start_tls`` is the most common path (port 587). Plain
            # ``use_tls`` is for 465 / TLS-on-connect setups.
            start_tls=settings.smtp_use_tls and settings.smtp_port != 465,
            use_tls=settings.smtp_use_tls and settings.smtp_port == 465,
            timeout=15,
        )
        return True
    except Exception as e:
        logger.warning(f"Failed to send email to {to_address}: {e}")
        return False


def build_password_reset_email(
    display_name: str,
    reset_link: str,
    expires_minutes: int,
) -> tuple[str, str]:
    """Render the plain-text + HTML bodies for a password-reset email."""
    name = display_name.strip() or "there"
    text = (
        f"Hi {name},\n\n"
        "Someone (hopefully you) requested a password reset for your "
        "Étude account. Click the link below within "
        f"{expires_minutes} minutes to choose a new password:\n\n"
        f"{reset_link}\n\n"
        "If you didn't request this, you can safely ignore this email — "
        "your password won't change.\n\n"
        "— Étude"
    )
    html = (
        "<!DOCTYPE html><html><body style=\"font-family:system-ui,sans-serif;"
        "background:#f7f5ee;padding:24px;color:#222;\">"
        f"<p>Hi {name},</p>"
        "<p>Someone (hopefully you) requested a password reset for your "
        "Étude account.</p>"
        "<p>"
        f'<a href="{reset_link}" '
        'style="display:inline-block;background:#1a5c5c;color:#fff;'
        'padding:10px 18px;border-radius:6px;text-decoration:none;">'
        "Reset your password</a>"
        "</p>"
        f"<p>This link expires in {expires_minutes} minutes.</p>"
        "<p style=\"color:#666;font-size:13px;\">If you didn't request this, "
        "you can safely ignore this email — your password won't change.</p>"
        "<p style=\"color:#666;font-size:13px;\">— Étude</p>"
        "</body></html>"
    )
    return text, html
