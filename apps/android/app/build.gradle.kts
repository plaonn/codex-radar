plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "dev.codexradar.cockpit"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.codexradar.cockpit"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-fixture"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    testOptions { unitTests.isIncludeAndroidResources = true }

    packaging {
        resources.excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("com.github.mwiede:jsch:2.28.5")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
}

tasks.register<Exec>("checkFixtureDrift") {
    group = "verification"
    description = "Fails when Android copies of the shared mobile protocol fixture drift."
    commandLine("python3", rootProject.file("tools/check_fixture_drift.py").absolutePath, "--check")
    workingDir = rootProject.projectDir
}

tasks.named("check") { dependsOn("checkFixtureDrift") }
