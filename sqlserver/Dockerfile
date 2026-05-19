# Custom SQL Server image for the spray-plant project.
#
# Why a custom image:
#   * init.sql lives INSIDE the image, so a `docker compose pull` workflow
#     brings the schema with it — no need to ship init.sql separately.
#   * On every container start, our entrypoint runs init.sql against the
#     persistent /var/opt/mssql volume.
#       First run  = creates LeatherCount + tables.
#       Subsequent = no-op (every CREATE is `IF NOT EXISTS`-guarded).
#
# Build & push (only when schema changes):
#   docker compose build sqlserver
#   docker push datacrumbs762/spray-plant-sqlserver:latest

FROM mcr.microsoft.com/mssql/server:2022-latest

USER root

COPY init.sql       /opt/spray-init/init.sql
COPY entrypoint.sh  /opt/spray-init/entrypoint.sh
RUN chmod +x /opt/spray-init/entrypoint.sh

# Drop back to the default mssql user so SQL Server boots normally.
USER mssql

ENTRYPOINT ["/opt/spray-init/entrypoint.sh"]
