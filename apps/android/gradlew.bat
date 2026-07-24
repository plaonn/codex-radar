@rem Fixture-only Android cockpit Gradle wrapper.
@set DIRNAME=%~dp0
@java -Xmx64m -Xms64m -Dorg.gradle.appname=gradlew -classpath "%DIRNAME%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
