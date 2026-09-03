import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, date as _date
from app.db.queries import get_plant_wise

# Load SMTP configuration from environment variables
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")
SMTP_TLS = os.getenv("SMTP_TLS", "True").lower() == "true"
SMTP_SSL = os.getenv("SMTP_SSL", "False").lower() == "true"


def _fmt_hms(total_seconds: int) -> str:
    """Format seconds into hh:mm:ss representation (or 00h 00m 00s)."""
    if not total_seconds:
        return "00h 00m 00s"
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    return f"{h:02d}h {m:02d}m {s:02d}s"


def get_report_data(date_str: str, plants: list[str]) -> dict:
    """
    Fetch day-wise and aggregated month-wise data for the requested plants.
    """
    # 1. Day-wise summary (one row per plant for today)
    day_rows = get_plant_wise(date_str, date_str)
    
    # Filter day rows to target plants
    filtered_day_rows = [r for r in day_rows if r["plant"] in plants]
    day_score = sum(r["pieces"] for r in filtered_day_rows)

    # 2. Month-wise summary (aggregated 1st of month to today)
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    first_of_month = dt.replace(day=1).strftime("%Y-%m-%d")
    
    month_raw_rows = get_plant_wise(first_of_month, date_str)
    
    # Aggregate by plant
    aggregated_month = {}
    for plant in plants:
        aggregated_month[plant] = {
            "plant": plant,
            "run_time_s": 0,
            "idle_time_s": 0,
            "maintenance_s": 0,
            "maintenance_pieces": 0,
            "overtime_s": 0,
            "pieces": 0,
        }

    for r in month_raw_rows:
        p = r["plant"]
        if p in aggregated_month:
            aggregated_month[p]["run_time_s"] += r["run_time_s"]
            aggregated_month[p]["idle_time_s"] += r["idle_time_s"]
            aggregated_month[p]["maintenance_s"] += r["maintenance_s"]
            aggregated_month[p]["maintenance_pieces"] += r["maintenance_pieces"]
            aggregated_month[p]["overtime_s"] += r["overtime_s"]
            aggregated_month[p]["pieces"] += r["pieces"]

    # Calculate utilization and format month-wise rows
    month_rows = []
    month_score = 0
    for plant in plants:
        pdata = aggregated_month[plant]
        run_s = pdata["run_time_s"]
        idle_s = pdata["idle_time_s"]
        observed = run_s + idle_s
        util_pct = round((run_s / observed) * 100, 1) if observed > 0 else 0.0
        
        maint_label = _fmt_hms(pdata["maintenance_s"]) if pdata["maintenance_s"] > 0 else ""
        if maint_label and pdata["maintenance_pieces"] > 0:
            maint_label = f"{maint_label} ({pdata['maintenance_pieces']} pcs)"
            
        month_rows.append({
            "plant": pdata["plant"],
            "run_time_label": _fmt_hms(run_s),
            "idle_time_label": _fmt_hms(idle_s),
            "maintenance_label": maint_label,
            "overtime_label": _fmt_hms(pdata["overtime_s"]) if pdata["overtime_s"] > 0 else "",
            "pieces": pdata["pieces"],
            "utilization_pct": util_pct
        })
        month_score += pdata["pieces"]

    # Calculate day-wise totals
    tot_day_run = sum(r["run_time_s"] for r in filtered_day_rows)
    tot_day_idle = sum(r["idle_time_s"] for r in filtered_day_rows)
    tot_day_maint_s = sum(r.get("maintenance_s", 0) for r in filtered_day_rows)
    tot_day_maint_pcs = sum(r.get("maintenance_pieces", 0) for r in filtered_day_rows)
    tot_day_overtime_s = sum(r.get("overtime_s", 0) for r in filtered_day_rows)
    tot_day_obs = tot_day_run + tot_day_idle
    tot_day_util = round((tot_day_run / tot_day_obs) * 100, 1) if tot_day_obs > 0 else 0.0

    day_maint_lbl = _fmt_hms(tot_day_maint_s) if tot_day_maint_s > 0 else ""
    if day_maint_lbl and tot_day_maint_pcs > 0:
        day_maint_lbl = f"{day_maint_lbl} ({tot_day_maint_pcs} pcs)"

    day_totals = {
        "run_time_label": _fmt_hms(tot_day_run),
        "idle_time_label": _fmt_hms(tot_day_idle),
        "maintenance_label": day_maint_lbl,
        "overtime_label": _fmt_hms(tot_day_overtime_s) if tot_day_overtime_s > 0 else "",
        "pieces": day_score,
        "utilization_pct": tot_day_util
    }

    # Calculate month-wise totals
    tot_month_run = sum(pdata["run_time_s"] for pdata in aggregated_month.values())
    tot_month_idle = sum(pdata["idle_time_s"] for pdata in aggregated_month.values())
    tot_month_maint_s = sum(pdata["maintenance_s"] for pdata in aggregated_month.values())
    tot_month_maint_pcs = sum(pdata["maintenance_pieces"] for pdata in aggregated_month.values())
    tot_month_overtime_s = sum(pdata["overtime_s"] for pdata in aggregated_month.values())
    tot_month_obs = tot_month_run + tot_month_idle
    tot_month_util = round((tot_month_run / tot_month_obs) * 100, 1) if tot_month_obs > 0 else 0.0

    month_maint_lbl = _fmt_hms(tot_month_maint_s) if tot_month_maint_s > 0 else ""
    if month_maint_lbl and tot_month_maint_pcs > 0:
        month_maint_lbl = f"{month_maint_lbl} ({tot_month_maint_pcs} pcs)"

    month_totals = {
        "run_time_label": _fmt_hms(tot_month_run),
        "idle_time_label": _fmt_hms(tot_month_idle),
        "maintenance_label": month_maint_lbl,
        "overtime_label": _fmt_hms(tot_month_overtime_s) if tot_month_overtime_s > 0 else "",
        "pieces": month_score,
        "utilization_pct": tot_month_util
    }

    return {
        "day_rows": filtered_day_rows,
        "day_score": day_score,
        "day_totals": day_totals,
        "month_rows": month_rows,
        "month_score": month_score,
        "month_totals": month_totals,
        "start_date_month": first_of_month
    }


def render_html_template(
    recipient_name: str,
    date_str: str,
    plants_label: str,
    data: dict
) -> str:
    """
    Renders a premium HTML email template with matching Dada Enterprises theme.
    """
    # Render Day Wise rows
    day_table_rows = ""
    for r in data["day_rows"]:
        maint = f'{r["maintenance_label"]} ({r["maintenance_pieces"]} pcs)' if r.get("maintenance_label") else ""
        day_table_rows += f"""
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #333;">{r['plant']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r['run_time_label']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r['idle_time_label']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{maint}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r.get('overtime_label') or ''}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #0c2340; text-align: right;">{r['pieces']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #2AAA8A; font-weight: bold; text-align: right;">{r['utilization_pct']}%</td>
        </tr>
        """

    # Render Month Wise rows
    month_table_rows = ""
    for r in data["month_rows"]:
        month_table_rows += f"""
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #333;">{r['plant']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r['run_time_label']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r['idle_time_label']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r['maintenance_label']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #555;">{r['overtime_label']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #0c2340; text-align: right;">{r['pieces']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #2AAA8A; font-weight: bold; text-align: right;">{r['utilization_pct']}%</td>
        </tr>
        """

    dt_day = data.get("day_totals", {})
    dt_month = data.get("month_totals", {})

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f4f6f9;
                margin: 0;
                padding: 0;
                -webkit-font-smoothing: antialiased;
            }}
            .container {{
                max-width: 800px;
                margin: 20px auto;
                background-color: #ffffff;
                border-radius: 12px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.05);
                overflow: hidden;
                border: 1px solid #e2e8f0;
            }}
            .header {{
                background-color: #0c2340;
                padding: 24px;
                color: #ffffff;
                text-align: center;
            }}
            .header h1 {{
                margin: 0;
                font-size: 20px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }}
            .header p {{
                margin: 5px 0 0 0;
                font-size: 13px;
                opacity: 0.8;
            }}
            .section {{
                padding: 24px;
            }}
            .section-title {{
                font-size: 16px;
                font-weight: bold;
                color: #0c2340;
                border-bottom: 2px solid #2AAA8A;
                padding-bottom: 6px;
                margin-top: 0;
                margin-bottom: 15px;
                text-transform: uppercase;
            }}
            .metadata-table {{
                width: 100%;
                margin-bottom: 15px;
                font-size: 13px;
                color: #4a5568;
                border-collapse: collapse;
            }}
            .metadata-table td {{
                padding: 4px 0;
            }}
            .metadata-label {{
                font-weight: bold;
                width: 120px;
            }}
            .report-table {{
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
                margin-bottom: 30px;
            }}
            .report-table th {{
                background-color: #0c2340;
                color: #ffffff;
                text-align: left;
                padding: 10px;
                font-weight: 600;
            }}
            .report-table td {{
                padding: 10px;
            }}
            .footer {{
                background-color: #f7fafc;
                padding: 15px;
                text-align: center;
                font-size: 11px;
                color: #a0aec0;
                border-top: 1px solid #edf2f7;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Dada Enterprises</h1>
                <p>Spray Plant Monitoring System Reports</p>
            </div>
            <div class="section">
                <p style="font-size: 14px; color: #2d3748; margin-top: 0; margin-bottom: 20px;">
                    Hello <strong>{recipient_name}</strong>,<br>
                    Please find below the daily and month-to-date production summary reports.
                </p>

                <!-- SECTION 1: DAY WISE REPORT -->
                <div class="section-title">Day Wise Plant Report</div>
                <table class="metadata-table">
                    <tr>
                        <td class="metadata-label">Start Date:</td>
                        <td>{date_str}</td>
                    </tr>
                    <tr>
                        <td class="metadata-label">End Date:</td>
                        <td>{date_str}</td>
                    </tr>
                    <tr>
                        <td class="metadata-label">Plant:</td>
                        <td>{plants_label}</td>
                    </tr>
                    <tr>
                        <td class="metadata-label" style="color: #0c2340;">Total Score:</td>
                        <td style="font-weight: bold; color: #0c2340; font-size: 15px;">{data['day_score']} pieces</td>
                    </tr>
                </table>

                <table class="report-table">
                    <thead>
                        <tr>
                            <th style="border-top-left-radius: 6px;">Plant</th>
                            <th>Total Run Time</th>
                            <th>Total Idle Time</th>
                            <th>Maintenance</th>
                            <th>Overtime</th>
                            <th style="text-align: right;">Pieces Processed</th>
                            <th style="border-top-right-radius: 6px; text-align: right;">Utilisation %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {day_table_rows}
                    </tbody>
                    <tfoot>
                        <tr style="background-color: #f7fafc; font-weight: bold; border-top: 2px solid #0c2340;">
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">Total</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_day.get('run_time_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_day.get('idle_time_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_day.get('maintenance_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_day.get('overtime_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340; text-align: right;">{dt_day.get('pieces', 0)}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #2AAA8A; text-align: right;">{dt_day.get('utilization_pct', 0)}%</td>
                        </tr>
                    </tfoot>
                </table>

                <!-- SECTION 2: MONTH WISE REPORT -->
                <div class="section-title">Month Wise Plant Report</div>
                <table class="metadata-table">
                    <tr>
                        <td class="metadata-label">Start Date:</td>
                        <td>{data['start_date_month']}</td>
                    </tr>
                    <tr>
                        <td class="metadata-label">End Date:</td>
                        <td>{date_str}</td>
                    </tr>
                    <tr>
                        <td class="metadata-label">Plant:</td>
                        <td>{plants_label}</td>
                    </tr>
                    <tr>
                        <td class="metadata-label" style="color: #0c2340;">Monthly Score:</td>
                        <td style="font-weight: bold; color: #0c2340; font-size: 15px;">{data['month_score']} pieces</td>
                    </tr>
                </table>

                <table class="report-table">
                    <thead>
                        <tr>
                            <th style="border-top-left-radius: 6px;">Plant</th>
                            <th>Total Run Time</th>
                            <th>Total Idle Time</th>
                            <th>Maintenance</th>
                            <th>Overtime</th>
                            <th style="text-align: right;">Pieces Processed</th>
                            <th style="border-top-right-radius: 6px; text-align: right;">Utilisation %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {month_table_rows}
                    </tbody>
                    <tfoot>
                        <tr style="background-color: #f7fafc; font-weight: bold; border-top: 2px solid #0c2340;">
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">Total</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_month.get('run_time_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_month.get('idle_time_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_month.get('maintenance_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340;">{dt_month.get('overtime_label', '')}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #0c2340; text-align: right;">{dt_month.get('pieces', 0)}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; color: #2AAA8A; text-align: right;">{dt_month.get('utilization_pct', 0)}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="footer">
                This is an automated report generated by the Spray Plant Monitoring System.<br>
                Dada Enterprises, Kasur &copy; {datetime.now().year}
            </div>
        </div>
    </body>
    </html>
    """
    return html


def send_email(to_email: str, subject: str, html_content: str) -> tuple[bool, str]:
    """Send SMTP email using dynamic environment variables. Returns (success, err_msg)."""
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "")
    smtp_tls = os.getenv("SMTP_TLS", "True").lower() == "true"
    smtp_ssl = os.getenv("SMTP_SSL", "False").lower() == "true"

    if not smtp_host or not smtp_user:
        err = "SMTP_HOST or SMTP_USER is missing from environment. Container needs restart after editing .env."
        print(f"[email] {err}")
        return False, err
        
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from or smtp_user
    msg["To"] = to_email
    msg.attach(MIMEText(html_content, "html"))

    try:
        if smtp_ssl:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            if smtp_tls:
                server.starttls()
                
        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)
            
        server.sendmail(msg["From"], [to_email], msg.as_string())
        server.quit()
        print(f"[email] Successfully sent daily report email to {to_email}")
        return True, ""
    except Exception as exc:
        err = str(exc)
        print(f"[email] Failed to send email to {to_email}: {err}")
        return False, err
